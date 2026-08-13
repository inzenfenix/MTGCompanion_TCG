import { useEffect, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { useVenvProgress } from '@/lib/useVenvProgress';
import type { EnvInfo, GpuInfo } from '@/lib/types';

function EnvSetupRow({ env, onChanged }: { env: EnvInfo; onChanged: () => void }) {
  // "attempted" (no "preparing") es lo que mantiene el hook de progreso
  // enganchado — si usáramos el booleano de "está corriendo ahora mismo",
  // el panel de log (y el error) desaparecería apenas la corrida terminara,
  // que es justo el momento en que hace falta verlo si terminó mal.
  const [attempted, setAttempted] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { messages, status } = useVenvProgress(attempted ? env.id : null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  const handlePrepare = async () => {
    setAttempted(true);
    setPreparing(true);
    setError(null);
    try {
      await api.ensureVenv(env.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparing(false);
    }
  };

  const failed = status === 'error' || !!error;

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{env.label}</p>
          <p className="text-xs text-muted-foreground">venv en {env.id}/.venv</p>
        </div>
        {env.ready ? (
          <Badge variant="success">listo</Badge>
        ) : (
          <Button size="sm" variant={failed ? 'destructive' : 'outline'} disabled={preparing} onClick={handlePrepare}>
            {preparing ? 'Instalando…' : failed ? 'Reintentar' : 'Preparar'}
          </Button>
        )}
      </div>

      {attempted && !env.ready && (
        <div className="space-y-1">
          <Progress value={preparing ? null : failed ? 0 : 100} />
          <div ref={logRef} className="max-h-28 overflow-y-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {messages.length === 0 ? 'arrancando…' : messages.map((m, i) => <div key={i}>{m}</div>)}
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>No se pudo preparar este entorno</AlertTitle>
          {/* select-text a propósito: este mensaje está pensado para copiarlo y pegarlo al pedir ayuda. */}
          <AlertDescription className="select-text font-mono text-[11px]">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function FirstRunSetup({ onDismiss }: { onDismiss: () => void }) {
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const [gpuError, setGpuError] = useState<string | null>(null);
  const [envs, setEnvs] = useState<EnvInfo[]>([]);

  const loadEnvs = () => {
    api.envs().then(setEnvs).catch(() => undefined); // App.tsx ya avisa si el server no responde
  };

  useEffect(() => {
    api
      .gpu()
      .then(setGpu)
      .catch((e) => setGpuError(e instanceof Error ? e.message : String(e)));
    loadEnvs();
  }, []);

  const gpuBadge =
    gpu?.backend === 'rocm'
      ? { label: 'AMD · ROCm', variant: 'success' as const }
      : gpu?.backend === 'cuda'
        ? { label: 'NVIDIA · CUDA', variant: 'success' as const }
        : { label: 'CPU (sin GPU)', variant: 'default' as const };

  const relevantEnvs = envs.filter((e) => e.needsVenv);
  const allReady = relevantEnvs.length > 0 && relevantEnvs.every((e) => e.ready);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <header>
        <h1 className="text-xl font-semibold">Configuración inicial</h1>
        <p className="text-sm text-muted-foreground">
          Antes de correr los scripts, preparamos los venvs de PyTorch / TensorFlow / Testing — detectando GPU
          automáticamente para instalar la versión acelerada que corresponda (o CPU si no hay ninguna compatible).
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>GPU detectada</CardTitle>
            {gpu && <Badge variant={gpuBadge.variant}>{gpuBadge.label}</Badge>}
          </div>
          <CardDescription>{gpu ? (gpu.deviceName ?? 'Sin GPU compatible') : 'Detectando…'}</CardDescription>
        </CardHeader>
        {gpu && gpu.notes.length > 0 && (
          <CardContent className="space-y-2">
            {gpu.notes.map((n, i) => (
              <Alert key={i} variant={gpu.backend === 'cpu' ? 'default' : 'info'}>
                <AlertDescription>{n}</AlertDescription>
              </Alert>
            ))}
          </CardContent>
        )}
        {gpuError && (
          <CardContent>
            <Alert variant="warning">
              <AlertTitle>No se pudo detectar la GPU</AlertTitle>
              <AlertDescription>{gpuError} — se instala en modo CPU por defecto.</AlertDescription>
            </Alert>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entornos</CardTitle>
          <CardDescription>Cada uno se prepara una sola vez — si el venv ya existe, no se toca.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {relevantEnvs.map((env) => (
            <EnvSetupRow key={env.id} env={env} onChanged={loadEnvs} />
          ))}
        </CardContent>
        <CardFooter className="flex-col items-end gap-2">
          <Button onClick={onDismiss} disabled={!allReady}>
            {allReady ? 'Continuar' : 'Continuar (faltan entornos por preparar)'}
          </Button>
          {!allReady && (
            <button onClick={onDismiss} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
              Saltar por ahora de todos modos
            </button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
