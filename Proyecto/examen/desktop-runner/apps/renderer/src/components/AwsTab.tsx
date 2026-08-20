import { useEffect, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AwsCredentialsBox } from './AwsCredentialsBox';
import { AwsServicesChecklist } from './AwsServicesChecklist';
import { TerraformActionCard } from './TerraformActionCard';
import { SsmAccessCard } from './SsmAccessCard';
import { LocalDevToolsCard } from './LocalDevToolsCard';
import { LogConsole } from './LogConsole';
import { ResultsView } from './ResultsView';
import { useRunLogs } from '@/lib/useRunLogs';
import { api } from '@/lib/api';
import type { ApplyBackendUrlResult, GithubStatus } from '@/lib/types';

/**
 * Pestaña "Deploy" (ROADMAP.md workstream I) — infraestructura AWS real vía
 * Terraform, para que el APK deje de apuntar a localhost. Deliberadamente
 * no lleva un ScriptDef ni entra en TAB_BUCKETS/useRunAllStatus (App.tsx):
 * las acciones de Terraform no son scripts de certamen_1/2, tienen su
 * propio estado acá adentro.
 */
export function AwsTab() {
  const [outputs, setOutputs] = useState<Record<string, unknown> | null>(null);
  const [loadingOutputs, setLoadingOutputs] = useState(true);
  // AwsCredentialsBox y TerraformActionCard son hermanos, no padre/hijo —
  // cada uno tiene su propio `settings` cargado una sola vez al montar.
  // Este contador es cómo uno le avisa al otro "guardé algo nuevo, volvé a
  // pedir /settings" sin levantar todo el estado de credenciales acá arriba.
  const [credentialsRefreshToken, setCredentialsRefreshToken] = useState(0);

  const loadOutputs = () => {
    setLoadingOutputs(true);
    api
      .terraformOutputs()
      .then(setOutputs)
      .finally(() => setLoadingOutputs(false));
  };

  useEffect(loadOutputs, []);

  return (
    <div className="space-y-4">
      <AwsCredentialsBox onSaved={() => setCredentialsRefreshToken((v) => v + 1)} />
      <AwsServicesChecklist />
      <TerraformActionCard credentialsRefreshToken={credentialsRefreshToken} />
      <SsmAccessCard />
      <OutputsCard outputs={outputs} loading={loadingOutputs} onReload={loadOutputs} />
      <PublishModelsCard />
      <GithubActionsCard productionBackendUrl={typeof outputs?.backend_url === 'string' ? outputs.backend_url : null} />
      <LocalDevToolsCard productionBackendUrl={typeof outputs?.backend_url === 'string' ? outputs.backend_url : null} />
    </div>
  );
}

/**
 * ROADMAP.md M1 — publica trading-app-ionic/public/models/ (los .onnx que
 * la pestaña Exportar deja localmente) a s3://{deploy_artifacts}/models/,
 * mismo bucket que ya usa el paso "0. Desplegar backend" de OutputsCard de
 * arriba, prefijo separado. Vive acá en Deploy, no en Exportar — es parte
 * del mismo hand-off "esto ya está listo para publicarse", no del proceso
 * de entrenar/exportar en sí. El "endpoint único" al que M2/M3 (planeados,
 * no construidos todavía — ver ROADMAP.md) apuntarán para armar el APK sin
 * re-entrenar nada, sin importar en qué PC se haya corrido el export.
 * Requiere credenciales AWS + un `apply` de Terraform ya corridos (ambos ya
 * cubiertos más arriba en esta misma pestaña) — el server devuelve un 400
 * con el motivo puntual si falta alguno de los dos, en vez de precondicionar
 * el botón acá y duplicar esa lógica.
 */
function PublishModelsCard() {
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logs = useRunLogs(runId);

  const upload = async () => {
    setError(null);
    setStarting(true);
    try {
      const { runId: id } = await api.uploadModelsToS3();
      setRunId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Publicar modelos (S3)</CardTitle>
        <CardDescription>
          Sube los <code className="font-mono">.onnx</code> exportados (pestaña "Exportar") a un bucket S3 compartido
          — así cualquier otra PC (o, más adelante, un pipeline de CI, ver ROADMAP.md workstream M) puede armar el
          APK con los últimos modelos sin tener que re-entrenar/re-exportar nada localmente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {runId && <LogConsole lines={logs.lines} currentLine={logs.currentLine} status={logs.status} lastActivityAt={logs.lastActivityAt} />}
      </CardContent>
      <CardFooter>
        <Button size="sm" variant="outline" disabled={starting || logs.status === 'running'} onClick={upload}>
          {logs.status === 'running' ? 'Subiendo…' : 'Subir modelos ONNX a S3'}
        </Button>
      </CardFooter>
    </Card>
  );
}

/**
 * ROADMAP.md M3 — dispara/sigue `.github/workflows/build-apk.yml` (M2)
 * desde acá en vez de tener que usar `gh` a mano. Mismo shape
 * streamed-runId/LogConsole que el resto de esta pestaña (PublishModelsCard
 * arriba, TerraformActionCard); el botón "Instalar" de gh CLI reusa el
 * mismo mecanismo/endpoint que ya instala terraform/aws cli
 * (tool-install.ts, `POST /terraform/install/:tool`, ver TerraformActionCard).
 * `gh auth login` es un flujo OAuth interactivo que este server no puede
 * automatizar — cuando falta, esta tarjeta solo muestra el comando exacto
 * para correrlo a mano, no intenta simularlo.
 */
function GithubActionsCard({ productionBackendUrl }: { productionBackendUrl: string | null }) {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendUrlOverride, setBackendUrlOverride] = useState('');
  const logs = useRunLogs(runId);

  const load = () => {
    api.githubStatus().then(setStatus).catch(() => undefined);
  };
  useEffect(load, []);

  // Mismo problema/solución que TerraformActionCard's install buttons: el
  // primer render después de setRunId todavía trae el `status` VIEJO (de
  // una corrida anterior), así que solo se cuenta como "instalación
  // terminada" una vez que este runId puntual ya se vio en "running".
  const sawRunningForRef = useRef<string | null>(null);
  useEffect(() => {
    if (runId && logs.status === 'running') sawRunningForRef.current = runId;
  }, [runId, logs.status]);
  useEffect(() => {
    if (installing && runId && sawRunningForRef.current === runId && logs.status !== 'running') {
      setInstalling(false);
      load();
    }
  }, [logs.status, runId, installing]);

  const startInstall = async () => {
    setError(null);
    setInstalling(true);
    sawRunningForRef.current = null;
    try {
      const { runId: id } = await api.installTool('gh');
      setRunId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInstalling(false);
    }
  };

  const startWorkflow = async () => {
    setError(null);
    setStarting(true);
    try {
      const { runId: id } = await api.runGithubApkWorkflow(backendUrlOverride.trim() || undefined);
      setRunId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const running = logs.status === 'running';
  const canRun = Boolean(status?.ghInstalled && status?.ghAuthenticated);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compilar APK (GitHub Actions)</CardTitle>
        <CardDescription>
          Dispara <code className="font-mono">build-apk.yml</code> (ROADMAP.md M2) — arma el APK en GitHub Actions
          usando los modelos publicados en S3 (tarjeta de arriba), sin usar esta máquina para el build.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!status && <p className="text-xs text-muted-foreground">Verificando gh CLI…</p>}

        {status && !status.ghInstalled && (
          <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span>GitHub CLI (gh) no está instalado en esta máquina.</span>
            <Button size="sm" variant="outline" disabled={installing} onClick={startInstall}>
              {installing ? 'Instalando…' : 'Instalar'}
            </Button>
          </div>
        )}

        {status?.ghInstalled && !status.ghAuthenticated && (
          <Alert variant="warning">
            <AlertTitle>gh no tiene una sesión activa</AlertTitle>
            <AlertDescription>
              Corré <code className="font-mono">gh auth login</code> en una terminal (flujo interactivo de GitHub —
              no se puede automatizar desde acá) y volvé a esta pestaña.
            </AlertDescription>
          </Alert>
        )}

        {status?.ghInstalled && status.ghAuthenticated && (
          <p className="text-xs text-muted-foreground">
            Repo detectado: <span className="font-mono">{status.repo ?? '—'}</span>
          </p>
        )}

        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground" htmlFor="gh-backend-url">
            Backend URL (opcional — vacío usa la variable BACKEND_URL del repo)
          </label>
          <input
            id="gh-backend-url"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            placeholder={productionBackendUrl ?? 'http://1.2.3.4:3000'}
            value={backendUrlOverride}
            onChange={(e) => setBackendUrlOverride(e.target.value)}
            disabled={running}
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {runId && <LogConsole lines={logs.lines} currentLine={logs.currentLine} status={logs.status} lastActivityAt={logs.lastActivityAt} />}
        {logs.results.length > 0 && <ResultsView results={logs.results} />}
      </CardContent>
      <CardFooter>
        <Button size="sm" disabled={!canRun || starting || running} onClick={startWorkflow}>
          {running ? 'Corriendo…' : 'Compilar APK'}
        </Button>
      </CardFooter>
    </Card>
  );
}

function copyValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function OutputsCard({
  outputs,
  loading,
  onReload,
}: {
  outputs: Record<string, unknown> | null;
  loading: boolean;
  onReload: () => void;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyBackendUrlResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deployRunId, setDeployRunId] = useState<string | null>(null);
  const [startingDeploy, setStartingDeploy] = useState(false);
  const deployLogs = useRunLogs(deployRunId);

  const [apkRunId, setApkRunId] = useState<string | null>(null);
  const [startingApk, setStartingApk] = useState(false);
  const apkLogs = useRunLogs(apkRunId);

  const [catalogRunId, setCatalogRunId] = useState<string | null>(null);
  const [startingCatalog, setStartingCatalog] = useState(false);
  const catalogLogs = useRunLogs(catalogRunId);

  const [seedRunId, setSeedRunId] = useState<string | null>(null);
  const [startingSeed, setStartingSeed] = useState(false);
  const seedLogs = useRunLogs(seedRunId);

  const copy = async (key: string, value: unknown) => {
    await navigator.clipboard.writeText(copyValue(value));
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
  };

  const copyAll = async () => {
    if (!outputs) return;
    await navigator.clipboard.writeText(JSON.stringify(outputs, null, 2));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const deployBackend = async () => {
    setError(null);
    setStartingDeploy(true);
    try {
      const { runId } = await api.deployBackend();
      setDeployRunId(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStartingDeploy(false);
    }
  };

  const applyBackendUrl = async () => {
    setError(null);
    setApplying(true);
    setApplyResult(null);
    try {
      setApplyResult(await api.applyAndroidBackendUrl());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const rebuildApk = async () => {
    setError(null);
    setStartingApk(true);
    try {
      const { runId } = await api.rebuildApk();
      setApkRunId(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStartingApk(false);
    }
  };

  const importCatalog = async () => {
    setError(null);
    setStartingCatalog(true);
    try {
      const { runId } = await api.importCatalog();
      setCatalogRunId(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStartingCatalog(false);
    }
  };

  const seedDatabase = async () => {
    setError(null);
    setStartingSeed(true);
    try {
      const { runId } = await api.seedDatabase();
      setSeedRunId(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStartingSeed(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Outputs</CardTitle>
          <div className="flex items-center gap-3">
            {outputs && (
              <Button size="sm" variant="outline" onClick={copyAll}>
                {copiedAll ? 'Copiado' : 'Copiar todo (JSON)'}
              </Button>
            )}
            <button onClick={onReload} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
              Actualizar
            </button>
          </div>
        </div>
        <CardDescription>
          Resultado de <code className="font-mono">terraform output</code> — cada valor tiene su botón de copiar. Los pasos
          de abajo son el resto del hand-off que <code className="font-mono">infra/terraform/README.md</code>{' '}
          documentaba a mano. El paso 0 sube <code className="font-mono">backend/</code> tal cual está en este checkout —
          usalo también para actualizar el código de un backend ya desplegado, no solo la primera vez.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-xs text-muted-foreground">Cargando…</p>}
        {!loading && !outputs && (
          <p className="text-xs text-muted-foreground">
            Sin outputs todavía — corré <code className="font-mono">apply</code> arriba primero.
          </p>
        )}

        {outputs && (
          <div className="space-y-1">
            {Object.entries(outputs).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-muted-foreground">{key}</div>
                  <div className="truncate font-mono text-xs">{copyValue(value)}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => copy(key, value)}>
                  {copiedKey === key ? 'Copiado' : 'Copiar'}
                </Button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        {applyResult && (
          <div className="rounded-md border border-border bg-muted/40 p-2 text-xs space-y-0.5">
            <p>{applyResult.envUpdated ? '✓' : '·'} {applyResult.envPath}</p>
            <p>
              {applyResult.xmlUpdated ? '✓' : applyResult.xmlSkippedReason ? '✗' : '·'}{' '}
              {applyResult.xmlSkippedReason ?? applyResult.xmlPath}
            </p>
          </div>
        )}
        {deployRunId && (
          <LogConsole
            lines={deployLogs.lines}
            currentLine={deployLogs.currentLine}
            status={deployLogs.status}
            lastActivityAt={deployLogs.lastActivityAt}
          />
        )}
        {apkRunId && (
          <LogConsole lines={apkLogs.lines} currentLine={apkLogs.currentLine} status={apkLogs.status} lastActivityAt={apkLogs.lastActivityAt} />
        )}
        {catalogRunId && (
          <LogConsole
            lines={catalogLogs.lines}
            currentLine={catalogLogs.currentLine}
            status={catalogLogs.status}
            lastActivityAt={catalogLogs.lastActivityAt}
          />
        )}
        {seedRunId && (
          <LogConsole lines={seedLogs.lines} currentLine={seedLogs.currentLine} status={seedLogs.status} lastActivityAt={seedLogs.lastActivityAt} />
        )}
      </CardContent>
      {outputs && (
        <CardFooter className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={startingDeploy || deployLogs.status === 'running'} onClick={deployBackend}>
            {deployLogs.status === 'running' ? 'Desplegando…' : '0. Desplegar backend (código)'}
          </Button>
          <Button size="sm" variant="outline" disabled={applying} onClick={applyBackendUrl}>
            {applying ? 'Aplicando…' : '1. Aplicar backend_url a la app'}
          </Button>
          <Button size="sm" variant="outline" disabled={startingApk || apkLogs.status === 'running'} onClick={rebuildApk}>
            {apkLogs.status === 'running' ? 'Reconstruyendo…' : '2. Reconstruir APK'}
          </Button>
          <Button size="sm" variant="outline" disabled={startingCatalog || catalogLogs.status === 'running'} onClick={importCatalog}>
            {catalogLogs.status === 'running' ? 'Importando…' : '3. Importar catálogo (58,679 cartas)'}
          </Button>
          <Button size="sm" variant="outline" disabled={startingSeed || seedLogs.status === 'running'} onClick={seedDatabase}>
            {seedLogs.status === 'running' ? 'Sembrando…' : '4. Cuentas de prueba (test@example.com / password123)'}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
