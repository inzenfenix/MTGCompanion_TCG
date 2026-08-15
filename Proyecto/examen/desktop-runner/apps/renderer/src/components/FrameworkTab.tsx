import { useEffect, useState } from 'react';
import { Tabs } from '@/components/ui/tabs';
import { ScriptCard } from './ScriptCard';
import { RunAllPanel } from './RunAllPanel';
import { useRunAllStatus } from '@/lib/useRunAllStatus';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ScriptInfo } from '@/lib/types';

type Framework = 'pytorch' | 'tensorflow';
type StageValue = 'retrieval' | 'stage1' | 'stage2' | 'stage3' | 'stage4';

// Qué script.id vive en cada subpestaña — mismo criterio que EXPORT_STAGES /
// RUN_ALL_SEQUENCES en scripts.config.ts (server), curado por id en vez de
// filtrado por `group`: así los exportadores (group:'pytorch'/'tensorflow'
// también) no aparecen acá, solo en la pestaña "Exportar".
const STAGE_SCRIPTS: Record<Framework, Record<StageValue, string[]>> = {
  pytorch: {
    retrieval: ['pt-embedder', 'shared-evaluate', 'pt-visualize', 'pt-finetune', 'pt-scanner'],
    stage1: ['pt-binary-classifier', 'pt-optuna-binary-classifier'],
    stage2: ['pt-text-validator', 'pt-optuna-text-validator'],
    stage3: ['pt-price-estimator', 'pt-optuna-price-estimator'],
    stage4: ['pt-condition-grader', 'pt-optuna-condition-grader', 'pt-condition-grader-combined', 'pt-predict-condition'],
  },
  tensorflow: {
    retrieval: ['tf-embeddings', 'shared-evaluate', 'tf-visualize', 'tf-scanner'],
    stage1: ['tf-binary-classifier', 'tf-optuna-binary-classifier'],
    stage2: ['tf-text-validator', 'tf-optuna-text-validator'],
    stage3: ['tf-price-estimator', 'tf-optuna-price-estimator'],
    stage4: ['tf-condition-grader', 'tf-optuna-condition-grader'],
  },
};

const STAGES: { value: StageValue; label: string }[] = [
  { value: 'retrieval', label: 'Embeddings / Retrieval' },
  { value: 'stage1', label: 'Stage 1 — Detector' },
  { value: 'stage2', label: 'Stage 2 — Validador de texto' },
  { value: 'stage3', label: 'Stage 3 — Precio' },
  { value: 'stage4', label: 'Stage 4 — Condición' },
];

// Scripts group:'shared' que aparecen en ambas pestañas con el mismo
// ScriptDef (mismo id, mismos args) — su default no puede saber sola en
// cuál pestaña la está renderizando quien llama, así que se sobreescribe
// puntualmente por id. Hoy solo shared-evaluate ("--model both" por
// default, corre pytorch Y tensorflow sin importar la pestaña donde se le
// da "Correr" a mano — ver ROADMAP.md, reportado por el usuario).
const SHARED_SCRIPT_OVERRIDES: Record<string, (framework: Framework) => Record<string, unknown>> = {
  'shared-evaluate': (framework) => ({ model: framework }),
};

export function FrameworkTab({ framework, scripts, onVenvChanged }: { framework: Framework; scripts: ScriptInfo[]; onVenvChanged: () => void }) {
  const [stage, setStage] = useState<StageValue>('retrieval');
  const [runAllSequences, setRunAllSequences] = useState<Record<Framework, string[]> | null>(null);
  const { statusByKey, activeScriptId } = useRunAllStatus(STAGE_SCRIPTS[framework]);

  useEffect(() => {
    api.runAllSequences().then(setRunAllSequences).catch(() => undefined);
  }, []);

  // "Correr todo" (o "Correr TODO") empuja la vista a la subpestaña que
  // está corriendo ahora mismo — así seguir el progreso es solo mirar cuál
  // subpestaña se activa sola, sin un panel de log aparte.
  useEffect(() => {
    if (!activeScriptId) return;
    const entry = (Object.entries(STAGE_SCRIPTS[framework]) as [StageValue, string[]][]).find(([, ids]) => ids.includes(activeScriptId));
    if (entry) setStage(entry[0]);
  }, [activeScriptId, framework]);

  const items = STAGES.map((s) => ({ ...s, status: statusByKey[s.value] }));

  return (
    <div className="space-y-4">
      <RunAllPanel label={framework} onStart={() => api.runAll(framework)} />

      <Tabs value={stage} onValueChange={(v) => setStage(v as StageValue)} items={items} />

      {STAGES.map(({ value }) => {
        // "Correr todo" de la subpestaña: mismos scripts que ya se listan
        // abajo, pero solo los que RUN_ALL_SEQUENCES ya marcó como seguros
        // de auto-correr (excluye Optuna/scanner/predict/finetune, ver el
        // comentario de getRunAllSequences() en scripts.controller.ts) — no
        // se muestra si la intersección queda vacía (ej. una subpestaña que
        // solo tiene un script interactivo, como "Testear").
        const runnableIds = STAGE_SCRIPTS[framework][value].filter((id) => runAllSequences?.[framework]?.includes(id));

        return (
          <div key={value} className={cn('space-y-4', value !== stage && 'hidden')}>
            {runnableIds.length > 0 && (
              <RunAllPanel label={`${framework}:${value}`} onStart={() => api.runSequence(`${framework}:${value}`, runnableIds)} />
            )}
            {STAGE_SCRIPTS[framework][value]
              .map((id) => scripts.find((s) => s.id === id))
              .filter((s): s is ScriptInfo => Boolean(s))
              .map((script) => (
                <ScriptCard
                  key={script.id}
                  script={script}
                  onVenvChanged={onVenvChanged}
                  initialValues={SHARED_SCRIPT_OVERRIDES[script.id]?.(framework)}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
