import { useEffect, useState, useCallback } from 'react';
import { Tabs } from '@/components/ui/tabs';
import { ScriptCard } from '@/components/ScriptCard';
import { RunAllPanel } from '@/components/RunAllPanel';
import { RunEverythingPanel } from '@/components/RunEverythingPanel';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ScriptGroup, ScriptInfo } from '@/lib/types';

const GROUPS: { value: ScriptGroup; label: string }[] = [
  { value: 'shared', label: 'Dataset compartido' },
  { value: 'pytorch', label: 'PyTorch' },
  { value: 'tensorflow', label: 'TensorFlow' },
  { value: 'testing', label: 'Testing' },
];

export default function App() {
  const [scripts, setScripts] = useState<ScriptInfo[]>([]);
  const [group, setGroup] = useState<ScriptGroup>('shared');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.scripts();
      setScripts(data);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">MTG Card Scanner — Runner</h1>
        <p className="text-sm text-muted-foreground">
          Corré los pipelines de certamen_1 (PyTorch / TensorFlow) sin usar la terminal.
        </p>
      </header>

      <div className="mb-6">
        <RunEverythingPanel />
      </div>

      <Tabs value={group} onValueChange={(v) => setGroup(v as ScriptGroup)} items={GROUPS} className="mb-6" />

      {loading && <p className="text-sm text-muted-foreground">Cargando scripts…</p>}
      {loadError && (
        <p className="text-sm text-destructive">
          No se pudo conectar con el server ({loadError}). ¿Está corriendo en http://127.0.0.1:4550?
        </p>
      )}

      {/*
        Cada grupo se mantiene siempre montado (solo se oculta con CSS) en vez de
        filtrarse fuera del árbol. Si se desmontara al cambiar de pestaña, cada
        ScriptCard perdería su estado (runId, logs, si ya corrió o no) y al volver
        parecería que nunca se corrió nada.
      */}
      {GROUPS.map(({ value }) => (
        <div key={value} className={cn('space-y-4', value !== group && 'hidden')}>
          {(value === 'pytorch' || value === 'tensorflow') && <RunAllPanel framework={value} />}

          {scripts
            .filter((s) => s.group === value)
            .map((script) => (
              <ScriptCard key={script.id} script={script} onVenvChanged={load} />
            ))}
        </div>
      ))}
    </div>
  );
}
