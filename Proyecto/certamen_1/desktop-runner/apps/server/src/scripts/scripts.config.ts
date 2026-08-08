import * as path from 'path';

/**
 * Raíz de certamen_1/, calculada en runtime relativa a este archivo compilado.
 * Este archivo compila a apps/server/dist/scripts/scripts.config.js, así que
 * hacen falta 5 niveles para llegar a certamen_1/:
 *   dist/scripts -> dist -> server -> apps -> desktop-runner -> certamen_1
 */
export const CERTAMEN_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..');

export type EnvId = 'pytorch' | 'tensorflow' | 'testing' | 'system';

export interface EnvDef {
  id: EnvId;
  label: string;
  /** Carpeta donde vive requirements.txt y donde se crea .venv. null = no usa venv (python del sistema). */
  dir: string | null;
  requirementsFile: string | null;
}

export const ENVS: Record<EnvId, EnvDef> = {
  pytorch: {
    id: 'pytorch',
    label: 'PyTorch (EfficientNet_b0)',
    dir: path.join(CERTAMEN_DIR, 'pytorch'),
    requirementsFile: path.join(CERTAMEN_DIR, 'pytorch', 'requirements.txt'),
  },
  tensorflow: {
    id: 'tensorflow',
    label: 'TensorFlow (MobileNetV3Small)',
    dir: path.join(CERTAMEN_DIR, 'tensorFlow'),
    requirementsFile: path.join(CERTAMEN_DIR, 'tensorFlow', 'requirements.txt'),
  },
  testing: {
    id: 'testing',
    label: 'Testing (comparación entre frameworks)',
    dir: path.join(CERTAMEN_DIR, 'Testing'),
    requirementsFile: path.join(CERTAMEN_DIR, 'Testing', 'requirements.txt'),
  },
  system: {
    id: 'system',
    label: 'Python del sistema (sin venv propio)',
    dir: null,
    requirementsFile: null,
  },
};

export type ArgKind = 'number' | 'float' | 'string' | 'boolean' | 'select' | 'file' | 'files';

export interface ArgDef {
  /** Nombre del flag (ej. "--max-cards"), o null si es un argumento posicional. */
  flag: string | null;
  /** Clave usada en el formulario / body del request. */
  name: string;
  kind: ArgKind;
  label: string;
  default?: string | number | boolean;
  options?: string[];
  required?: boolean;
  help?: string;
  /** Para posicionales con nargs="*": permite 0..N archivos. */
  multiple?: boolean;
}

export interface ResultFileDef {
  /** Identifica el tipo de resultado para que el frontend sepa cómo renderizarlo. */
  kind: 'scanner' | 'metrics' | 'optuna' | 'classifier-metrics';
  label: string;
  path: string;
}

export interface LiveFileDef {
  /** Identifica el tipo de dato en vivo para que el frontend sepa cómo renderizarlo. */
  kind: 'training-history';
  path: string;
}

export interface ScriptDef {
  id: string;
  group: 'shared' | 'pytorch' | 'tensorflow' | 'testing';
  label: string;
  description: string;
  /** Carpeta de trabajo (cwd) al ejecutar el script. */
  cwd: string;
  /** Ruta del .py relativa a cwd. */
  script: string;
  /** Qué entorno (venv) provee el intérprete de Python. */
  env: EnvId;
  args: ArgDef[];
  /**
   * Archivos JSON que el script escribe con su resultado (además de imprimirlo
   * por consola) — el server los lee al terminar con éxito y se los manda al
   * renderer por WebSocket para mostrar una vista de resultados en vez de solo
   * texto plano. Función de los valores del form porque algunos (shared-evaluate)
   * escriben en una ruta que depende de un argumento (--model).
   */
  resultFiles?: (values: Record<string, unknown>) => ResultFileDef[];
  /**
   * Archivo que el script reescribe periódicamente mientras corre (ej. historial
   * de loss por época) — el server lo poll-ea mientras el proceso está 'running'
   * y emite cada cambio por WebSocket para graficar en vivo.
   */
  liveFile?: (values: Record<string, unknown>) => LiveFileDef | null;
}

const PT_DIR = path.join(CERTAMEN_DIR, 'pytorch');
const TF_DIR = path.join(CERTAMEN_DIR, 'tensorFlow');
const TEST_DIR = path.join(CERTAMEN_DIR, 'Testing');

export const SCRIPTS: ScriptDef[] = [
  // ── Compartidos (raíz de certamen_1/) ──────────────────────────────────
  {
    id: 'shared-scraper',
    group: 'shared',
    label: '01 · Scraper de catálogo (Scryfall)',
    description:
      'Descarga y filtra el catálogo de cartas desde la API de Scryfall. Genera data/cards.json. Usa el venv de pytorch/ (incluye requests).',
    cwd: CERTAMEN_DIR,
    script: '01_scraper.py',
    env: 'pytorch',
    args: [
      { flag: '--max-cards', name: 'max_cards', kind: 'number', label: 'Cap de cartas (0 = sin cap, ~30k)', default: 5000 },
      { flag: '--quality', name: 'quality', kind: 'select', label: 'Calidad de imagen', options: ['small', 'normal', 'large', 'png'], default: 'small' },
    ],
  },
  {
    id: 'shared-downloader',
    group: 'shared',
    label: '02 · Downloader de imágenes',
    description:
      'Descarga las imágenes de cards.json (idempotente, reanudable, ~3.6 GB en corrida completa). Usa el venv de pytorch/.',
    cwd: CERTAMEN_DIR,
    script: '02_downloader.py',
    env: 'pytorch',
    args: [
      { flag: '--workers', name: 'workers', kind: 'number', label: 'Workers en paralelo', default: 4 },
      { flag: '--delay', name: 'delay', kind: 'float', label: 'Delay entre requests (s)', default: 0.06 },
    ],
  },
  {
    id: 'shared-evaluate',
    group: 'shared',
    label: '04 · Evaluar retrieval (orquestador)',
    description:
      'Punto de entrada único de evaluación: corre pytorch/, tensorflow/ o ambos, cada uno en su propio venv (los crea si faltan). No necesita venv propio.',
    cwd: CERTAMEN_DIR,
    script: '04_evaluate.py',
    env: 'system',
    args: [
      { flag: '--model', name: 'model', kind: 'select', label: 'Framework a evaluar', options: ['both', 'pytorch', 'tensorflow'], default: 'both' },
    ],
    // El orquestador corre cada framework en un subproceso propio y guarda sus métricas
    // en output/<framework>/<timestamp>/metrics_*.json, actualizando además
    // output/<framework>/latest para apuntar siempre a la corrida más reciente.
    resultFiles: (values) => {
      const model = (values.model as string) || 'both';
      const files: ResultFileDef[] = [];
      if (model === 'both' || model === 'pytorch') {
        files.push({ kind: 'metrics', label: 'Métricas — PyTorch', path: path.join(CERTAMEN_DIR, 'output', 'pytorch', 'latest', 'metrics_pt.json') });
      }
      if (model === 'both' || model === 'tensorflow') {
        files.push({ kind: 'metrics', label: 'Métricas — TensorFlow', path: path.join(CERTAMEN_DIR, 'output', 'tensorflow', 'latest', 'metrics_tf.json') });
      }
      return files;
    },
  },

  // ── PyTorch ─────────────────────────────────────────────────────────────
  {
    id: 'pt-embedder',
    group: 'pytorch',
    label: '03 · Construir embeddings (EfficientNet_b0)',
    description: 'Extrae embeddings de todo el dataset. Requiere que 01/02 ya hayan corrido.',
    cwd: PT_DIR,
    script: '03_pt_embedder.py',
    env: 'pytorch',
    args: [],
  },
  {
    id: 'pt-visualize',
    group: 'pytorch',
    label: '05 · Visualizar (t-SNE + EDA)',
    description: 'Genera t-SNE coloreado y gráficos exploratorios del dataset.',
    cwd: PT_DIR,
    script: '05_visualize.py',
    env: 'pytorch',
    args: [],
  },
  {
    id: 'pt-finetune',
    group: 'pytorch',
    label: '06 · Fine-tuning contrastivo (SimCLR, opcional)',
    description: 'Fine-tuning opcional del embedder. Puede tardar bastante.',
    cwd: PT_DIR,
    script: '06_finetune.py',
    env: 'pytorch',
    args: [],
  },
  {
    id: 'pt-binary-classifier',
    group: 'pytorch',
    label: '07 · Clasificador MTG / no-MTG',
    description: 'Entrena el detector binario (EfficientNet_b0). Descarga Pokémon como negativos la primera vez.',
    cwd: PT_DIR,
    script: '07_binary_classifier.py',
    env: 'pytorch',
    args: [
      { flag: '--skip-download', name: 'skip_download', kind: 'boolean', label: 'Reutilizar Pokémon ya descargados', default: false },
      { flag: '--n', name: 'n', kind: 'number', label: 'Cartas por clase', default: 3000 },
      { flag: '--epochs', name: 'epochs', kind: 'number', label: 'Épocas', default: 15 },
    ],
    resultFiles: () => [
      { kind: 'classifier-metrics', label: 'Clasificador MTG/no-MTG — PyTorch', path: path.join(PT_DIR, 'results', 'metrics_binary.json') },
    ],
    liveFile: () => ({ kind: 'training-history', path: path.join(PT_DIR, 'results', 'training_history.json') }),
  },
  {
    id: 'pt-optuna-binary-classifier',
    group: 'pytorch',
    label: '08 · Búsqueda de hiperparámetros (Optuna)',
    description: 'Optimiza el clasificador binario con Optuna. Puede tardar mucho según --trials.',
    cwd: PT_DIR,
    script: '08_optuna_binary_classifier.py',
    env: 'pytorch',
    args: [
      { flag: '--skip-download', name: 'skip_download', kind: 'boolean', label: 'Reutilizar Pokémon ya descargados', default: false },
      { flag: '--n', name: 'n', kind: 'number', label: 'Cartas por clase', default: 3000 },
      { flag: '--trials', name: 'trials', kind: 'number', label: 'Cantidad de trials', default: 20 },
      { flag: '--trial-epochs', name: 'trial_epochs', kind: 'number', label: 'Épocas por trial', default: 6 },
      { flag: '--final-epochs', name: 'final_epochs', kind: 'number', label: 'Épocas del entrenamiento final', default: 15 },
      { flag: '--timeout-hours', name: 'timeout_hours', kind: 'float', label: 'Timeout (horas, opcional)' },
      { flag: '--study-name', name: 'study_name', kind: 'string', label: 'Nombre del estudio Optuna', default: 'mtg_detector_pytorch' },
      { flag: '--resume-dir', name: 'resume_dir', kind: 'string', label: 'Retomar estudio desde (ruta, opcional)' },
      { flag: '--seed', name: 'seed', kind: 'number', label: 'Seed', default: 42 },
      { flag: '--no-final-train', name: 'no_final_train', kind: 'boolean', label: 'No entrenar el modelo final', default: false },
    ],
    // El script guarda cada corrida en output/pytorch/optuna/<timestamp>/ y
    // actualiza output/pytorch/optuna/latest. Si --no-final-train está activo,
    // final_metrics.json no existe — se omite solo, no rompe nada.
    resultFiles: () => [
      { kind: 'optuna', label: 'Optuna — PyTorch', path: path.join(CERTAMEN_DIR, 'output', 'pytorch', 'optuna', 'latest', 'best_params.json') },
      { kind: 'classifier-metrics', label: 'Modelo final — PyTorch', path: path.join(CERTAMEN_DIR, 'output', 'pytorch', 'optuna', 'latest', 'final_metrics.json') },
    ],
  },
  {
    id: 'pt-export-onnx',
    group: 'pytorch',
    label: '09 · Exportar a ONNX',
    description:
      'Exporta el detector MTG/no-MTG ya entrenado (mtg_detector.pth) a ONNX, verificando que las salidas coincidan con el modelo original. No reentrena nada.',
    cwd: PT_DIR,
    script: '09_export_onnx.py',
    env: 'pytorch',
    args: [
      { flag: '--imagen', name: 'imagen', kind: 'file', label: 'Imagen de verificación (opcional, si no se usa un tensor aleatorio)' },
      { flag: '--opset', name: 'opset', kind: 'number', label: 'Versión de opset ONNX', default: 18 },
      { flag: '--tolerancia', name: 'tolerancia', kind: 'float', label: 'Tolerancia de verificación', default: 0.0001 },
    ],
  },
  {
    id: 'pt-scanner',
    group: 'pytorch',
    label: 'Scanner · Identificar una carta',
    description: 'Corre el pipeline de dos etapas (detector + retrieval) sobre una foto.',
    cwd: PT_DIR,
    script: 'scanner.py',
    env: 'pytorch',
    args: [
      { flag: null, name: 'imagen', kind: 'file', label: 'Imagen de la carta', required: true },
      { flag: '--top', name: 'top', kind: 'number', label: 'Top-N candidatos', default: 5 },
      { flag: '--threshold', name: 'threshold', kind: 'float', label: 'Umbral de similitud', default: 0.75 },
      { flag: '--tta', name: 'tta', kind: 'number', label: 'Test-Time Augmentation (N pasadas)', default: 1 },
      { flag: '--finetuned', name: 'finetuned', kind: 'boolean', label: 'Usar embeddings fine-tuneados', default: false },
      { flag: '--skip-detect', name: 'skip_detect', kind: 'boolean', label: 'Saltar detector binario', default: false },
    ],
    resultFiles: () => [{ kind: 'scanner', label: 'Resultado del scanner', path: path.join(PT_DIR, 'results', 'last_scan.json') }],
  },

  // ── TensorFlow ──────────────────────────────────────────────────────────
  {
    id: 'tf-embeddings',
    group: 'tensorflow',
    label: '03 · Construir índice de embeddings (MobileNetV3Small)',
    description: 'Construye data/indexes/magic_embeddings.pkl. Requiere que 01/02 ya hayan corrido.',
    cwd: TF_DIR,
    script: '03_build_embeddings.py',
    env: 'tensorflow',
    args: [{ flag: '--force', name: 'force', kind: 'boolean', label: 'Reconstruir aunque ya exista', default: false }],
  },
  {
    id: 'tf-visualize',
    group: 'tensorflow',
    label: '05 · Visualizar (t-SNE + EDA)',
    description: 'Genera t-SNE coloreado y gráficos exploratorios del dataset.',
    cwd: TF_DIR,
    script: '05_visualize.py',
    env: 'tensorflow',
    args: [],
  },
  {
    id: 'tf-binary-classifier',
    group: 'tensorflow',
    label: '07 · Clasificador MTG / no-MTG',
    description: 'Entrena el detector binario (MobileNetV3Small). Puede reutilizar los Pokémon descargados por el pipeline PyTorch.',
    cwd: TF_DIR,
    script: '07_binary_classifier.py',
    env: 'tensorflow',
    args: [
      { flag: '--skip-download', name: 'skip_download', kind: 'boolean', label: 'Reutilizar Pokémon ya descargados', default: true },
      { flag: '--n', name: 'n', kind: 'number', label: 'Cartas por clase', default: 3000 },
      { flag: '--epochs', name: 'epochs', kind: 'number', label: 'Épocas', default: 15 },
    ],
    resultFiles: () => [
      { kind: 'classifier-metrics', label: 'Clasificador MTG/no-MTG — TensorFlow', path: path.join(TF_DIR, 'results', 'metrics_binary.json') },
    ],
    liveFile: () => ({ kind: 'training-history', path: path.join(TF_DIR, 'results', 'training_history.json') }),
  },
  {
    id: 'tf-optuna-binary-classifier',
    group: 'tensorflow',
    label: '08 · Búsqueda de hiperparámetros (Optuna)',
    description: 'Optimiza el clasificador binario con Optuna. Puede tardar mucho según --trials.',
    cwd: TF_DIR,
    script: '08_optuna_binary_classifier.py',
    env: 'tensorflow',
    args: [
      { flag: '--skip-download', name: 'skip_download', kind: 'boolean', label: 'Reutilizar Pokémon ya descargados', default: true },
      { flag: '--n', name: 'n', kind: 'number', label: 'Cartas por clase', default: 3000 },
      { flag: '--trials', name: 'trials', kind: 'number', label: 'Cantidad de trials', default: 20 },
      { flag: '--trial-epochs', name: 'trial_epochs', kind: 'number', label: 'Épocas por trial', default: 6 },
      { flag: '--final-epochs', name: 'final_epochs', kind: 'number', label: 'Épocas del entrenamiento final', default: 15 },
      { flag: '--timeout-hours', name: 'timeout_hours', kind: 'float', label: 'Timeout (horas, opcional)' },
      { flag: '--study-name', name: 'study_name', kind: 'string', label: 'Nombre del estudio Optuna', default: 'mtg_detector_tensorflow' },
      { flag: '--seed', name: 'seed', kind: 'number', label: 'Seed', default: 42 },
      { flag: '--no-final-train', name: 'no_final_train', kind: 'boolean', label: 'No entrenar el modelo final', default: false },
    ],
    resultFiles: () => [
      { kind: 'optuna', label: 'Optuna — TensorFlow', path: path.join(CERTAMEN_DIR, 'output', 'tensorflow', 'optuna', 'latest', 'best_params.json') },
      { kind: 'classifier-metrics', label: 'Modelo final — TensorFlow', path: path.join(CERTAMEN_DIR, 'output', 'tensorflow', 'optuna', 'latest', 'final_metrics.json') },
    ],
  },
  {
    id: 'tf-scanner',
    group: 'tensorflow',
    label: 'Scanner · Identificar una carta',
    description: 'Identifica una carta por similitud coseno contra el índice de embeddings.',
    cwd: TF_DIR,
    script: 'scanner.py',
    env: 'tensorflow',
    args: [
      { flag: null, name: 'image', kind: 'file', label: 'Imagen de la carta', required: true },
      { flag: '--top-k', name: 'top_k', kind: 'number', label: 'Top-K candidatos', default: 3 },
      { flag: '--threshold', name: 'threshold', kind: 'float', label: 'Umbral de similitud', default: 0.75 },
    ],
    resultFiles: () => [{ kind: 'scanner', label: 'Resultado del scanner', path: path.join(TF_DIR, 'results', 'last_scan.json') }],
  },

  // ── Testing (comparación entre frameworks) ────────────────────────────
  {
    id: 'test-compare',
    group: 'testing',
    label: 'Comparar ambos scanners',
    description:
      'Corre pytorch/scanner.py y tensorFlow/scanner.py (cada uno en su propio venv) sobre la(s) misma(s) imagen(es) y compara resultados. Sin imágenes = usa todas las de testing_photos/.',
    cwd: TEST_DIR,
    script: 'compare_scanners.py',
    env: 'testing',
    args: [
      { flag: null, name: 'imagenes', kind: 'files', label: 'Imágenes a comparar (opcional)', multiple: true },
      { flag: '--top', name: 'top', kind: 'number', label: 'Top-N candidatos', default: 5 },
      { flag: '--threshold', name: 'threshold', kind: 'float', label: 'Umbral de similitud', default: 0.75 },
      { flag: '--skip-detect', name: 'skip_detect', kind: 'boolean', label: 'Saltar detector binario (PyTorch)', default: false },
    ],
  },
  {
    id: 'test-random-card',
    group: 'testing',
    label: 'Descargar carta aleatoria y comparar',
    description: 'Pide una carta al azar a Scryfall, la guarda en testing_photos/ y corre la comparación.',
    cwd: TEST_DIR,
    script: 'download_random_card.py',
    env: 'testing',
    args: [
      { flag: '--quality', name: 'quality', kind: 'select', label: 'Calidad de imagen', options: ['small', 'normal', 'large', 'png'], default: 'normal' },
      { flag: '--no-compare', name: 'no_compare', kind: 'boolean', label: 'Solo descargar (no comparar)', default: false },
      { flag: '--top', name: 'top', kind: 'number', label: 'Top-N candidatos', default: 5 },
      { flag: '--threshold', name: 'threshold', kind: 'float', label: 'Umbral de similitud', default: 0.75 },
      { flag: '--skip-detect', name: 'skip_detect', kind: 'boolean', label: 'Saltar detector binario (PyTorch)', default: false },
    ],
  },
];

/**
 * Secuencia recomendada para "Correr todo" por framework (ver README de certamen_1).
 * El dataset compartido (shared-scraper, shared-downloader) se corre una sola vez antes,
 * no por framework.
 */
export const RUN_ALL_SEQUENCES: Record<'pytorch' | 'tensorflow', string[]> = {
  pytorch: ['pt-embedder', 'shared-evaluate', 'pt-visualize', 'pt-binary-classifier'],
  tensorflow: ['tf-embeddings', 'shared-evaluate', 'tf-visualize', 'tf-binary-classifier'],
};

export function findScript(id: string): ScriptDef | undefined {
  return SCRIPTS.find((s) => s.id === id);
}
