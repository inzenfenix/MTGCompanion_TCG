import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { LogConsole } from './LogConsole';
import { useRunLogs } from '@/lib/useRunLogs';
import { api } from '@/lib/api';
import type { RunnerSettings, TerraformAction, TerraformStatus } from '@/lib/types';

const STALE_AFTER_MS = 3.5 * 60 * 60 * 1000;

const ACTIONS: { action: TerraformAction; label: string; destructive?: boolean; confirmCopy?: string }[] = [
  { action: 'init', label: 'init' },
  { action: 'validate', label: 'validate' },
  { action: 'plan', label: 'plan' },
  {
    action: 'apply',
    label: 'apply',
    destructive: true,
    confirmCopy: 'Esto crea recursos AWS reales y facturables (EC2, EBS, S3, Secrets Manager), y abre el puerto 3000 del backend a internet. ¿Confirmás?',
  },
  {
    action: 'destroy',
    label: 'destroy',
    destructive: true,
    confirmCopy: 'Esto DESTRUYE los recursos AWS de este stack — incluida cualquier data en Postgres/S3/MinIO. Es irreversible. ¿Confirmás?',
  },
];

/**
 * Una sola tarjeta con los 5 comandos de Terraform (init/validate/plan/
 * apply/destroy), compartiendo una única LogConsole/useRunLogs — mismo
 * shape que ScriptCard.tsx pero sin ArgForm (Terraform no tiene args de
 * usuario acá, solo la acción). apply/destroy piden confirmación explícita
 * en un segundo click (no un solo botón que ya dispara) y quedan
 * deshabilitados sin credenciales configuradas.
 */
export function TerraformActionCard() {
  const [status, setStatus] = useState<TerraformStatus | null>(null);
  const [settings, setSettings] = useState<RunnerSettings | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<TerraformAction | null>(null);
  const [starting, setStarting] = useState<TerraformAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const runLogs = useRunLogs(runId);
  const { lines, currentLine, status: runStatus, lastActivityAt, refresh } = runLogs;

  const load = () => {
    api.terraformStatus().then(setStatus);
    api.getSettings().then(setSettings);
  };
  useEffect(load, []);

  const creds = settings?.awsCredentials ?? null;
  const stale = creds ? Date.now() - creds.savedAt > STALE_AFTER_MS : false;
  const disabledReason = !status?.terraformInstalled
    ? 'terraform no está instalado en esta máquina.'
    : !creds
      ? 'Pegá tus credenciales AWS arriba primero.'
      : null;

  const start = async (action: TerraformAction, confirm: boolean) => {
    setError(null);
    setPendingConfirm(null);
    setStarting(action);
    try {
      const { runId: id } = await api.runTerraform(action, confirm);
      setRunId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(null);
    }
  };

  const handleClick = (action: TerraformAction, destructive?: boolean) => {
    if (destructive) {
      setPendingConfirm(action);
      return;
    }
    start(action, false);
  };

  const handleStop = async () => {
    if (!runId) return;
    setStopping(true);
    try {
      const { ok } = await api.stop(runId);
      if (!ok) await refresh();
    } finally {
      setStopping(false);
    }
  };

  const running = runStatus === 'running';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>Terraform</CardTitle>
          {status && <Badge variant={status.eligible ? 'success' : 'error'}>{status.eligible ? 'listo' : 'no disponible'}</Badge>}
        </div>
        <CardDescription>
          Corre <code className="font-mono">terraform</code> en{' '}
          <code className="font-mono">Proyecto/examen/infra/terraform/</code> — mismos comandos que la terminal, acá
          streameados. <code className="font-mono">apply</code>/<code className="font-mono">destroy</code> crean/destruyen
          infraestructura real y facturable, nunca se disparan con un solo click.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {disabledReason && <p className="text-xs text-amber-700">{disabledReason}</p>}
        {stale && !disabledReason && (
          <p className="text-xs text-amber-700">Las credenciales AWS guardadas pueden estar vencidas — considerá repegarlas.</p>
        )}
        {status && !status.awsCliInstalled && (
          <p className="text-xs text-muted-foreground">
            aws cli no detectado — no bloquea Terraform, pero{' '}
            <code className="font-mono">scripts/deploy-backend.sh</code> lo necesita.
          </p>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        {pendingConfirm && (
          <Alert variant="destructive">
            <AlertTitle>Confirmar "{pendingConfirm}"</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{ACTIONS.find((a) => a.action === pendingConfirm)?.confirmCopy}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={() => start(pendingConfirm, true)}>
                  Sí, {pendingConfirm}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPendingConfirm(null)}>
                  Cancelar
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {runId && <LogConsole lines={lines} currentLine={currentLine} status={runStatus} lastActivityAt={lastActivityAt} />}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {ACTIONS.map(({ action, label, destructive }) => (
          <Button
            key={action}
            size="sm"
            variant={destructive ? 'destructive' : 'outline'}
            disabled={!!disabledReason || running || starting === action}
            onClick={() => handleClick(action, destructive)}
          >
            {starting === action ? `${label}…` : label}
          </Button>
        ))}
        {running && (
          <Button size="sm" variant="destructive" onClick={handleStop} disabled={stopping}>
            {stopping ? 'Deteniendo…' : 'Detener'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
