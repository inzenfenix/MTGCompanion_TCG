import { spawn } from 'child_process';
import { probeCommand, REPO_ROOT } from './tf-docker';
import { pathEnvWithToolBin } from './tool-install';

/**
 * ROADMAP.md M3 — dispara/sigue `.github/workflows/build-apk.yml` (M2)
 * desde el Deploy tab vía `gh` CLI. Mismo espíritu que terraform.ts para el
 * stack de Terraform: el server sabe correr/streamear el comando, la UI da
 * el botón. Todo corre con `cwd: REPO_ROOT` para que `gh` resuelva el repo
 * solo, del remote de git de este checkout — nunca hardcodeado.
 */

export const BUILD_APK_WORKFLOW = 'build-apk.yml';

export interface GithubEligibility {
  ghInstalled: boolean;
  /** `gh auth status` — `gh auth login` es un flujo OAuth interactivo, no algo que este server pueda automatizar (ver M3 en ROADMAP.md); si esto es false, la UI muestra el comando para correrlo a mano. */
  ghAuthenticated: boolean;
  /** owner/repo resuelto por `gh repo view` — null si gh no está instalado/autenticado, o si este checkout no tiene un remote de GitHub reconocible. */
  repo: string | null;
}

/**
 * stdout completo de `cmd args` — rechaza con stderr (si lo hay) en el
 * mensaje cuando el exit code no es 0. Nunca `shell: true`: los args
 * (incluido cualquier input del usuario, ej. backendUrl) van directo al
 * array de `spawn`, no interpolados en una string de shell.
 */
function runCapture(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd ?? REPO_ROOT, env: opts.env ?? pathEnvWithToolBin() });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let out = '';
    let errOut = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.stderr?.on('data', (d) => (errOut += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`"${cmd} ${args.join(' ')}" terminó con código ${code}${errOut.trim() ? `: ${errOut.trim()}` : ''}`));
    });
  });
}

export async function getGithubEligibility(): Promise<GithubEligibility> {
  const env = pathEnvWithToolBin();
  const ghInstalled = await probeCommand('gh', ['--version'], env);
  if (!ghInstalled) return { ghInstalled: false, ghAuthenticated: false, repo: null };

  const ghAuthenticated = await probeCommand('gh', ['auth', 'status'], env);
  if (!ghAuthenticated) return { ghInstalled: true, ghAuthenticated: false, repo: null };

  let repo: string | null = null;
  try {
    repo = (await runCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { env })).trim() || null;
  } catch {
    // Sin remote de GitHub reconocible en este checkout, o sin acceso al repo — no es fatal, solo "no se pudo resolver".
  }
  return { ghInstalled: true, ghAuthenticated: true, repo };
}

export interface GithubRunInfo {
  databaseId: number;
  number: number;
  status: string;
  conclusion: string | null;
  url: string;
}

/** Los últimos `limit` runs de BUILD_APK_WORKFLOW, más recientes primero — usado para detectar cuál run nuevo aparece después de dispatch(). */
export async function listWorkflowRuns(repo: string, env: NodeJS.ProcessEnv, limit = 5): Promise<GithubRunInfo[]> {
  const out = await runCapture(
    'gh',
    ['run', 'list', '--repo', repo, '--workflow', BUILD_APK_WORKFLOW, '--limit', String(limit), '--json', 'databaseId,number,status,conclusion,url'],
    { env },
  );
  return JSON.parse(out);
}

export async function dispatchApkWorkflow(repo: string, env: NodeJS.ProcessEnv, backendUrl?: string): Promise<void> {
  const args = ['workflow', 'run', BUILD_APK_WORKFLOW, '--repo', repo];
  if (backendUrl) args.push('-f', `backend_url=${backendUrl}`);
  await runCapture('gh', args, { env });
}

export interface GithubReleaseInfo {
  tag: string;
  releaseUrl: string;
  apkAssetUrl: string | null;
}

/** `gh release view apk-<runNumber>` — el tag que build-apk.yml le pone a la release que publica (`softprops/action-gh-release`, ver ese workflow). */
export async function getApkRelease(repo: string, env: NodeJS.ProcessEnv, runNumber: number): Promise<GithubReleaseInfo> {
  const tag = `apk-${runNumber}`;
  const out = await runCapture('gh', ['release', 'view', tag, '--repo', repo, '--json', 'url,assets'], { env });
  const parsed: { url: string; assets: { name: string; url: string }[] } = JSON.parse(out);
  const apkAsset = parsed.assets.find((a) => a.name.endsWith('.apk'));
  return { tag, releaseUrl: parsed.url, apkAssetUrl: apkAsset?.url ?? null };
}

/**
 * `cmd args` con `input` escrito a stdin en vez de pasado como arg — para
 * `gh secret set`, cuyo valor NUNCA debe ir en el array de args (quedaría
 * visible en la lista de procesos del SO). Mismo `runCapture` de arriba,
 * solo que además alimenta stdin antes de esperar el cierre.
 */
function runCaptureWithStdin(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; input: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd ?? REPO_ROOT, env: opts.env ?? pathEnvWithToolBin() });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let out = '';
    let errOut = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.stderr?.on('data', (d) => (errOut += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`"${cmd} ${args.join(' ')}" terminó con código ${code}${errOut.trim() ? `: ${errOut.trim()}` : ''}`));
    });
    child.stdin.write(opts.input);
    child.stdin.end();
  });
}

/**
 * ROADMAP.md M3 (follow-up) — configura las 3 repo Variables + 3 Secrets
 * que `build-apk.yml` necesita (ver el header de ese workflow), en vez de
 * que alguien tenga que correr 6 comandos de `gh` a mano cada vez que las
 * credenciales AWS Academy expiran. Los valores de las Variables (no
 * sensibles: región, nombre de bucket, URL) sí van como arg de `gh
 * variable set` — mismo criterio que el resto de esta app, que ya los
 * muestra en la UI sin problema. Los 3 Secrets van por stdin, nunca como
 * arg.
 */
export async function setRepoVariable(repo: string, env: NodeJS.ProcessEnv, name: string, value: string): Promise<void> {
  await runCapture('gh', ['variable', 'set', name, '--repo', repo, '--body', value], { env });
}

export async function setRepoSecret(repo: string, env: NodeJS.ProcessEnv, name: string, value: string): Promise<void> {
  await runCaptureWithStdin('gh', ['secret', 'set', name, '--repo', repo], { env, input: value });
}
