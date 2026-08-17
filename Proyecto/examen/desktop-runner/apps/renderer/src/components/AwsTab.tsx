import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AwsCredentialsBox } from './AwsCredentialsBox';
import { AwsServicesChecklist } from './AwsServicesChecklist';
import { TerraformActionCard } from './TerraformActionCard';
import { SsmAccessCard } from './SsmAccessCard';
import { LogConsole } from './LogConsole';
import { useRunLogs } from '@/lib/useRunLogs';
import { api } from '@/lib/api';
import type { ApplyBackendUrlResult } from '@/lib/types';

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
    </div>
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
