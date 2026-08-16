import { useEffect, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LogConsole } from './LogConsole';
import { useRunLogs } from '@/lib/useRunLogs';
import { api } from '@/lib/api';
import type { SsmInstanceDef, SsmInstanceKey, SsmStatus } from '@/lib/types';

/**
 * Acceso a las 4 instancias EC2 vía SSM Session Manager — reemplaza tanto
 * SSH (nunca tuvo una key pair real asociada) como la idea original de un
 * bastion host (ver la conversación que llevó a esto): ningún security
 * group tiene puertos administrativos abiertos, todo pasa por acá.
 * "Abrir terminal" lanza una terminal NATIVA del SO (sesión interactiva
 * real) — la LogConsole de esta app solo streamea en un sentido, no sirve
 * para un shell de verdad. "Abrir túnel" sí usa esa LogConsole (es un
 * proceso de fondo con inicio/fin real, no algo interactivo).
 */
export function SsmAccessCard() {
  const [instances, setInstances] = useState<SsmInstanceDef[]>([]);
  const [status, setStatus] = useState<SsmStatus | null>(null);
  const [installRunId, setInstallRunId] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const installLogs = useRunLogs(installRunId);

  const load = () => {
    api.ssmInstances().then(setInstances);
    api.ssmStatus().then(setStatus);
  };
  useEffect(load, []);

  // Mismo cuidado con la carrera que TerraformActionCard.tsx ya documenta:
  // solo se cuenta como "instalación terminada" una vez que este runId
  // puntual ya se vio en "running" al menos una vez.
  const sawRunningForRef = useRef<string | null>(null);
  useEffect(() => {
    if (installRunId && installLogs.status === 'running') sawRunningForRef.current = installRunId;
  }, [installRunId, installLogs.status]);
  useEffect(() => {
    if (installing && installRunId && sawRunningForRef.current === installRunId && installLogs.status !== 'running') {
      setInstalling(false);
      load();
    }
  }, [installLogs.status, installRunId, installing]);

  const startInstall = async () => {
    setError(null);
    setInstalling(true);
    sawRunningForRef.current = null;
    try {
      const { runId } = await api.installTool('session-manager-plugin');
      setInstallRunId(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInstalling(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>Acceso a instancias (SSM)</CardTitle>
          {status && (
            <Badge variant={status.sessionManagerPluginInstalled ? 'success' : 'error'}>
              {status.sessionManagerPluginInstalled ? 'listo' : 'falta el plugin'}
            </Badge>
          )}
        </div>
        <CardDescription>
          Sin SSH, sin bastion, sin puertos administrativos abiertos — cada instancia se conecta vía AWS Systems
          Manager Session Manager, autenticado por IAM. Necesita un <code className="font-mono">terraform apply</code>{' '}
          ya corrido (los instance ids salen de ahí).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status && !status.sessionManagerPluginInstalled && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-amber-700">
              Falta el <code className="font-mono">session-manager-plugin</code> — hace falta para "Abrir terminal" (no
              para los túneles ni para <code className="font-mono">deploy-backend.sh</code>).
            </p>
            <Button size="sm" variant="outline" disabled={installing} onClick={startInstall}>
              {installing ? 'Instalando…' : 'Instalar session-manager-plugin'}
            </Button>
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {installRunId && (
          <LogConsole
            lines={installLogs.lines}
            currentLine={installLogs.currentLine}
            status={installLogs.status}
            lastActivityAt={installLogs.lastActivityAt}
          />
        )}

        <div className="space-y-2">
          {instances.map((instance) => (
            <SsmInstanceRow key={instance.key} instance={instance} pluginReady={status?.sessionManagerPluginInstalled ?? false} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SsmInstanceRow({ instance, pluginReady }: { instance: SsmInstanceDef; pluginReady: boolean }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [tunnelRunId, setTunnelRunId] = useState<string | null>(null);
  const [startingTunnel, setStartingTunnel] = useState(false);
  const tunnelLogs = useRunLogs(tunnelRunId);
  const tunnelRunning = tunnelLogs.status === 'running';

  const rawCommand = `aws ssm start-session --target <${instance.outputKey}>`;

  const openTerminal = async () => {
    setError(null);
    setOpening(true);
    try {
      await api.ssmOpenTerminal(instance.key);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  };

  const copyCommand = async () => {
    await navigator.clipboard.writeText(rawCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startTunnel = async () => {
    setError(null);
    setStartingTunnel(true);
    try {
      const { runId } = await api.ssmStartPortForward(instance.key);
      setTunnelRunId(runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStartingTunnel(false);
    }
  };

  const stopTunnel = async () => {
    if (!tunnelRunId) return;
    const { ok } = await api.stop(tunnelRunId);
    if (!ok) await tunnelLogs.refresh();
  };

  return (
    <div className="rounded-md border border-border p-2 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{instance.label}</span>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!pluginReady || opening} onClick={openTerminal}>
            {opening ? 'Abriendo…' : 'Abrir terminal'}
          </Button>
          <Button size="sm" variant="outline" onClick={copyCommand}>
            {copied ? 'Copiado' : 'Copiar comando'}
          </Button>
          {instance.webPort &&
            (tunnelRunning ? (
              <Button size="sm" variant="destructive" onClick={stopTunnel}>
                Detener túnel
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={startingTunnel} onClick={startTunnel}>
                {startingTunnel ? 'Abriendo túnel…' : 'Abrir túnel'}
              </Button>
            ))}
        </div>
      </div>
      {instance.webPort && tunnelRunning && (
        <p className="text-xs text-muted-foreground">
          Túnel activo →{' '}
          <a
            href={`http://localhost:${instance.webPort}`}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            http://localhost:{instance.webPort}
          </a>
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {tunnelRunId && (
        <LogConsole
          lines={tunnelLogs.lines}
          currentLine={tunnelLogs.currentLine}
          status={tunnelLogs.status}
          lastActivityAt={tunnelLogs.lastActivityAt}
        />
      )}
    </div>
  );
}
