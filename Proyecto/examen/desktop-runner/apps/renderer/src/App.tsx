import { useEffect, useState, useCallback } from 'react';
import { Tabs } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ScriptCard } from '@/components/ScriptCard';
import { RoboflowApiKeyBox } from '@/components/RoboflowApiKeyBox';
import { FrameworkTab } from '@/components/FrameworkTab';
import { RunEverythingPanel } from '@/components/RunEverythingPanel';
import { FirstRunSetup } from '@/components/FirstRunSetup';
import { ExportPanel } from '@/components/ExportPanel';
import { AwsTab } from '@/components/AwsTab';
import { api } from '@/lib/api';
import { useRunAllStatus } from '@/lib/useRunAllStatus';
import { cn } from '@/lib/utils';
import type { ScriptInfo } from '@/lib/types';

// Se guarda en localStorage (no en el server) porque es una preferencia de
// esta máquina/perfil de usuario, no del proyecto — cerrar la configuración
// inicial acá no debería afectar a otro teammate corriendo el mismo runner.
const ONBOARDING_DISMISSED_KEY = 'mtg-runner:onboarding-dismissed';

// Pestañas de nivel superior. No son un filtro plano por `script.group` —
// cada una se cura por id (mismo patrón que ya usaba ExportPanel) para que
// los exportadores (group:'pytorch'/'tensorflow' también) no aparezcan
// duplicados fuera de "Exportar". "Scraper" es solo un rename de lo que
// antes se llamaba "Dataset compartido" (mismo contenido: scraper del
// catálogo + downloader de imágenes + descarga de negativos) — sigue
// siendo UNA sola pestaña, no dos.
type TabValue = 'scraper' | 'pytorch' | 'tensorflow' | 'testing' | 'export' | 'aws';

const TABS: { value: TabValue; label: string }[] = [
  { value: 'scraper', label: 'Scraper' },
  { value: 'pytorch', label: 'PyTorch' },
  { value: 'tensorflow', label: 'TensorFlow' },
  { value: 'testing', label: 'Testing' },
  { value: 'export', label: 'Exportar' },
  { value: 'aws', label: 'Deploy' },
];

const SCRAPER_TAB_SCRIPTS = [
  'shared-scraper',
  'shared-downloader',
  'shared-real-photos',
  'shared-real-negatives',
  'shared-download-roboflow',
  'shared-download-negatives',
];

// Buckets para el ícono de estado de cada pestaña (ver useRunAllStatus.ts) —
// deliberadamente los mismos ids que RUN_ALL_DOWNLOAD_SEQUENCE /
// RUN_ALL_SEQUENCES / RUN_ALL_EXPORT_SEQUENCE en scripts.config.ts (server):
// eso es justo lo que corre "Correr Todo", en el mismo orden que las pestañas.
const TAB_BUCKETS: Record<string, string[]> = {
  scraper: ['shared-downloader', 'shared-real-photos'],
  pytorch: ['pt-embedder', 'shared-evaluate', 'pt-visualize', 'pt-binary-classifier', 'pt-text-validator', 'pt-price-estimator', 'pt-condition-grader'],
  tensorflow: ['tf-embeddings', 'shared-evaluate', 'tf-visualize', 'tf-binary-classifier', 'tf-text-validator', 'tf-price-estimator', 'tf-condition-grader'],
  // Stage 3's order is deliberately TF-then-PT, not PT-then-TF like every
  // other stage — see scripts.config.ts's RUN_ALL_EXPORT_SEQUENCE comment
  // (ROADMAP.md E2, 16 ago): the two frameworks' stage3-price-estimator.onnx
  // aren't interchangeable (1330 vs 626 input dims) and only PyTorch's has a
  // matching stage1-embedder.onnx, so PyTorch must be the one left standing.
  export: [
    'pt-export-onnx',
    'tf-export-onnx',
    'pt-export-onnx-text-validator',
    'tf-export-onnx-text-validator',
    'tf-export-onnx-price-estimator',
    'pt-export-onnx-price-estimator',
    'pt-export-onnx-price-embedding',
    // TF-then-PT for Stage 4 too — mirrors scripts.config.ts's
    // RUN_ALL_EXPORT_SEQUENCE comment: PyTorch's combined checkpoint clearly
    // outperforms TensorFlow's, "last wins" must leave PyTorch's live.
    'tf-export-onnx-condition',
    'pt-export-onnx-condition',
  ],
};

export default function App() {
  const [scripts, setScripts] = useState<ScriptInfo[]>([]);
  const [tab, setTab] = useState<TabValue>('scraper');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [checkedOnboarding, setCheckedOnboarding] = useState(false);
  const { statusByKey, activeScriptId } = useRunAllStatus(TAB_BUCKETS);

  const load = useCallback(async () => {
    try {
      const data = await api.scripts();
      setScripts(data);
      setLoadError(null);

      // Solo se decide una vez, la primera vez que los scripts cargan bien —
      // si el usuario cierra la configuración con "Saltar por ahora" no debe
      // reaparecer sola después solo porque un venv sigue sin estar listo.
      if (!checkedOnboarding) {
        setCheckedOnboarding(true);
        const dismissed = localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1';
        const anyMissing = data.some((s) => s.env !== 'system' && !s.venvReady);
        if (!dismissed && anyMissing) setShowSetup(true);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [checkedOnboarding]);

  useEffect(() => {
    load();
  }, [load]);

  // "Correr Todo" empuja la vista a la pestaña que está corriendo ahora
  // mismo — así seguir el progreso es solo mirar cuál pestaña se activa
  // sola (y, adentro de PyTorch/TensorFlow, FrameworkTab hace lo mismo con
  // sus subpestañas de stage).
  useEffect(() => {
    if (!activeScriptId) return;
    const entry = Object.entries(TAB_BUCKETS).find(([, ids]) => ids.includes(activeScriptId));
    if (entry) setTab(entry[0] as TabValue);
  }, [activeScriptId]);

  const dismissSetup = () => {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
    setShowSetup(false);
    load();
  };

  if (showSetup) {
    return <FirstRunSetup onDismiss={dismissSetup} />;
  }

  const items = TABS.map((t) => ({ ...t, status: statusByKey[t.value] }));

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">MTG Card Scanner — Runner</h1>
          <p className="text-sm text-muted-foreground">
            Corre los pipelines de certamen_1 (PyTorch / TensorFlow) sin usar la terminal.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowSetup(true)}>
          ⚙ Configuración inicial
        </Button>
      </header>

      <div className="mb-6">
        <RunEverythingPanel />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} items={items} className="mb-6" />

      {loading && <p className="text-sm text-muted-foreground">Cargando scripts…</p>}
      {loadError && (
        <p className="text-sm text-destructive">
          No se pudo conectar con el server ({loadError}). ¿Está corriendo en http://127.0.0.1:4550?
        </p>
      )}

      {/*
        Cada pestaña se mantiene siempre montada (solo se oculta con CSS) en vez de
        filtrarse fuera del árbol. Si se desmontara al cambiar de pestaña, cada
        ScriptCard perdería su estado (runId, logs, si ya corrió o no) y al volver
        parecería que nunca se corrió nada.
      */}
      {TABS.map(({ value }) => (
        <div key={value} className={cn('space-y-4', value !== tab && 'hidden')}>
          {value === 'pytorch' || value === 'tensorflow' ? (
            <FrameworkTab framework={value} scripts={scripts} onVenvChanged={load} />
          ) : value === 'export' ? (
            <ExportPanel scripts={scripts} onVenvChanged={load} />
          ) : value === 'aws' ? (
            <AwsTab />
          ) : value === 'testing' ? (
            scripts.filter((s) => s.group === 'testing').map((script) => <ScriptCard key={script.id} script={script} onVenvChanged={load} />)
          ) : (
            <>
              <RoboflowApiKeyBox />
              {SCRAPER_TAB_SCRIPTS.map((id) => scripts.find((s) => s.id === id))
                .filter((s): s is ScriptInfo => Boolean(s))
                .map((script) => <ScriptCard key={script.id} script={script} onVenvChanged={load} />)}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
