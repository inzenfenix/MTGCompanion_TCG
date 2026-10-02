import { useEffect, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { api } from '@/lib/api';
import { useVenvProgress } from '@/lib/useVenvProgress';
import type { EnvInfo, GpuInfo, RunnerSettings, TensorflowExecutionMode, TfDockerStatus } from '@/lib/types';

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
  const isDocker = env.id === 'tensorflow-docker';

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{env.label}</p>
          <p className="text-xs text-muted-foreground">
            {isDocker ? 'imagen Docker (~11GB la primera vez, después queda en caché local)' : `venv en ${env.id}/.venv`}
          </p>
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

/**
 * Elegir cómo corren los scripts de TensorFlow: venv (CPU — siempre
 * disponible, no hay wheel ROCm mantenido para AMD) o el escape hatch de
 * Docker (`docker/tf-rocm/`, ROADMAP.md workstream D) con la GPU AMD pasada
 * al contenedor. Solo se muestra si hay una GPU AMD detectada — para
 * NVIDIA/CPU-only esta elección no tiene sentido (CUDA ya acelera directo
 * en el venv, no existe un tercer modo).
 */
function TensorflowModeCard({
  gpu,
  tfStatus,
  mode,
  onModeChange,
}: {
  gpu: GpuInfo;
  tfStatus: TfDockerStatus | null;
  mode: TensorflowExecutionMode;
  onModeChange: (m: TensorflowExecutionMode) => void;
}) {
  if (gpu.backend !== 'rocm') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>TensorFlow en esta GPU AMD</CardTitle>
        <CardDescription>
          No hay wheel ROCm mantenido para instalar TensorFlow acelerado vía pip — el venv siempre corre en CPU. La
          alternativa es un contenedor Docker con la imagen oficial de AMD, GPU incluida.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="inline-flex rounded-md border border-border p-1">
          <button
            onClick={() => onModeChange('venv')}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'venv' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            CPU (venv)
          </button>
          <button
            onClick={() => onModeChange('docker')}
            disabled={!tfStatus?.eligible}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              mode === 'docker' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            GPU vía Docker (ROCm)
          </button>
        </div>

        {!tfStatus && <p className="text-xs text-muted-foreground">Chequeando si Docker está disponible…</p>}

        {tfStatus && !tfStatus.eligible && (
          <Alert variant="default">
            <AlertDescription>{tfStatus.reason}</AlertDescription>
          </Alert>
        )}

        {tfStatus?.eligible && mode === 'docker' && (
          <Alert variant="info">
            <AlertDescription>
              Imagen <code className="font-mono">{tfStatus.imageTag}</code>. El override de{' '}
              <code className="font-mono">HSA_OVERRIDE_GFX_VERSION</code> que esta GPU necesita (si le hace falta —
              ver panel de arriba) se aplica solo en cada corrida, igual que con PyTorch — no hay nada que exportar a
              mano.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export function FirstRunSetup({ onDismiss }: { onDismiss: () => void }) {
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const [gpuError, setGpuError] = useState<string | null>(null);
  const [envs, setEnvs] = useState<EnvInfo[]>([]);
  const [tfStatus, setTfStatus] = useState<TfDockerStatus | null>(null);
  const [settings, setSettings] = useState<RunnerSettings | null>(null);

  const loadEnvs = () => {
    api.envs().then(setEnvs).catch(() => undefined); // App.tsx ya avisa si el server no responde
  };

  useEffect(() => {
    api
      .gpu()
      .then(setGpu)
      .catch((e) => setGpuError(e instanceof Error ? e.message : String(e)));
    api.tfDockerStatus().then(setTfStatus).catch(() => undefined);
    api.getSettings().then(setSettings).catch(() => undefined);
    loadEnvs();
  }, []);

  const handleModeChange = async (m: TensorflowExecutionMode) => {
    // Optimista: la UI cambia ya, y si el POST falla se revierte — evita un
    // parpadeo del toggle mientras espera la respuesta.
    const previous = settings;
    setSettings((s) => (s ? { ...s, tensorflowExecutionMode: m } : s));
    try {
      const next = await api.updateSettings({ tensorflowExecutionMode: m });
      setSettings(next);
      loadEnvs(); // el filtro de qué fila mostrar (venv vs. Docker) depende del modo
    } catch {
      setSettings(previous);
    }
  };

  const gpuBadge =
    gpu?.backend === 'rocm'
      ? { label: 'AMD · ROCm', variant: 'success' as const }
      : gpu?.backend === 'cuda'
        ? { label: 'NVIDIA · CUDA', variant: 'success' as const }
        : { label: 'CPU (sin GPU)', variant: 'default' as const };

  const tfMode: TensorflowExecutionMode = settings?.tensorflowExecutionMode ?? 'venv';
  const dockerActive = tfMode === 'docker' && !!tfStatus?.eligible;

  // La fila "tensorflow" (venv) y "tensorflow-docker" (imagen) son
  // mutuamente excluyentes en la UI — cuál se prepara depende del modo
  // elegido arriba. Las demás (pytorch, testing) no cambian.
  const relevantEnvs = envs.filter((e) => {
    if (!e.needsVenv) return false;
    if (e.id === 'tensorflow' && dockerActive) return false;
    if (e.id === 'tensorflow-docker' && !dockerActive) return false;
    return true;
  });
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

      {gpu && <TensorflowModeCard gpu={gpu} tfStatus={tfStatus} mode={tfMode} onModeChange={handleModeChange} />}

      <Card>
        <CardHeader>
          <CardTitle>Entornos</CardTitle>
          <CardDescription>Cada uno se prepara una sola vez — si el venv (o la imagen) ya existe, no se toca.</CardDescription>
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
