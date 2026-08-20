import * as path from 'path';

/**
 * Raíz de certamen_1/, calculada en runtime relativa a este archivo compilado.
 * Este archivo compila a apps/server/dist/scripts/scripts.config.js. Desde
 * que desktop-runner se movió a Proyecto/examen/ (antes vivía adentro de
 * Proyecto/certamen_1/), certamen_1/ ya no es un ancestro directo — hacen
 * falta 6 niveles para llegar a Proyecto/, y de ahí bajar a certamen_1/:
 *   dist/scripts -> dist -> server -> apps -> desktop-runner -> examen -> Proyecto -> certamen_1
 */
export const CERTAMEN_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'certamen_1');

/** Igual que CERTAMEN_DIR pero apuntando a certamen_2/ (hermano de certamen_1/ bajo Proyecto/). */
export const CERTAMEN2_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'certamen_2');

export type EnvId = 'pytorch' | 'tensorflow' | 'testing' | 'certamen2' | 'system';

export interface EnvDef {
  id: EnvId;
  label: string;
  /** Carpeta donde vive requirements.txt y donde se crea .venv. null = no usa venv (python del sistema). */
  dir: string | null;
  requirementsFile: string | null;
  /**
   * Binarios de Python a probar, en orden, al CREAR el venv (no al correrlo
   * después — ahí siempre se usa el python de adentro del venv ya creado).
   * El primero que responda a "--version" gana; si ninguno está como
   * comando suelto en PATH (típico en Arch/CachyOS — pacman solo empaqueta
   * UN python3 del sistema, a diferencia de Debian/Fedora que dan
   * python3.12/3.11/etc. como paquetes separados), se prueba resolverlo vía
   * pyenv (ver resolvePyenvPython() en scripts.service.ts — matchea contra
   * las versiones que pyenv ya tenga instaladas). Si eso tampoco encuentra
   * nada, cae al python genérico del sistema (ver systemPython()).
   * Existe por paquetes como TensorFlow, que no publican wheel para la
   * versión de Python más nueva apenas sale (ej. no hay tensorflow para
   * 3.14 todavía) — sin esto, "python3" resuelve a esa versión nueva y la
   * instalación falla con "no matching distribution" (ver ROADMAP.md C11).
   */
  preferredPythonBins?: string[];
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
    // TensorFlow suele tardar meses/años en soportar la última versión de
    // Python — se prueban las últimas que sí tienen wheel conocido primero.
    preferredPythonBins: ['python3.12', 'python3.11', 'python3.10'],
  },
  testing: {
    id: 'testing',
    label: 'Testing (comparación entre frameworks)',
    dir: path.join(CERTAMEN_DIR, 'Testing'),
    requirementsFile: path.join(CERTAMEN_DIR, 'Testing', 'requirements.txt'),
  },
  certamen2: {
    id: 'certamen2',
    label: 'Certamen 2 (preparación de datasets — Stage 2/3/4)',
    // Venv liviano, framework-agnóstico (pandas/sklearn/opencv-headless/
    // pytesseract, ver certamen_2/requirements.txt) — deliberadamente sin
    // torch/tensorflow, así los scripts de prepare_*_dataset.py no tienen
    // que instalar ninguno de los dos frameworks pesados solo para leer
    // cards.json y correr OCR/OpenCV (ver ROADMAP.md workstream C, C1).
    dir: CERTAMEN2_DIR,
    requirementsFile: path.join(CERTAMEN2_DIR, 'requirements.txt'),
  },
  system: {
    id: 'system',
    label: 'Python del sistema (sin venv propio)',
    dir: null,
    requirementsFile: null,
  },
};

export type ArgKind = 'number' | 'float' | 'string' | 'boolean' | 'select' | 'file' | 'files' | 'card-percentage';

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
  /**
   * Para kind:"select" — valor de `options` que el runner recomienda por
   * defecto. Solo cambia cómo se etiqueta la opción en el <select> ("(Recomendado)"),
   * no el valor que se manda al script.
   */
  recommended?: string;
  /**
   * Este arg se recalcula automáticamente como `factor * valor(arg)` cada
   * vez que cambia `arg` — hasta que el usuario lo edita a mano una vez, a
   * partir de ahí queda desvinculado (ver ScriptCard.tsx). Pensado para
   * "workers" -> "delay" en shared-downloader: con workers paralelos
   * independientes, cada uno respetando su propio delay, la tasa de
   * requests AGREGADA contra Scryfall es workers/delay — sin esto, subir
   * workers sin subir delay en la misma proporción multiplica esa tasa sin
   * que se note en el form, que es probablemente lo que causó una descarga
   * "colgada" (ver README, sección Downloader).
   */
  linkedFrom?: { arg: string; factor: number };
  /**
   * No se renderiza en el form — se manda igual con su `default` (ver
   * ArgForm.tsx). Para flags que siempre deben ir con el mismo valor (ej.
   * "--download-only" en shared-download-negatives) sin exponer un control
   * que no tiene sentido que el usuario toque.
   */
  hidden?: boolean;
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
      {
        flag: '--max-cards',
        name: 'max_cards',
        kind: 'card-percentage',
        label: 'Porcentaje del catálogo a descargar',
        // Se mantiene el mismo default "en cartas" que tenía el número plano
        // (5000) — el slider lo traduce a % apenas conoce el total real
        // (GET /scripts/shared-scraper/card-count). 100% no es "todas las
        // impresiones que existen": sigue siendo la definición del propio
        // script (nombres únicos, hasta MAX_PRINTINGS_POR_CARTA impresiones
        // c/u, filtros de idioma/set_type/layout aplicados) — ver
        // filtrar_y_limpiar() en 01_scraper.py.
        default: 5000,
        help: '100% = todo lo que permiten los filtros del scraper (sin cap artificial), no "cada impresión de cada carta" — el script ya deduplica a lo sumo 3 impresiones por nombre.',
      },
      {
        flag: '--quality',
        name: 'quality',
        kind: 'select',
        label: 'Calidad de imagen',
        options: ['small', 'normal', 'large', 'png'],
        default: 'small',
        recommended: 'small',
        help: 'Recomendado: "small" — el pipeline redimensiona toda imagen a 224×224 antes de entrenar (pytorch/03_pt_embedder.py, tensorFlow/src/config.py), así que pedir más resolución de origen no mejora el modelo, solo aumenta tiempo y ancho de banda de descarga.',
      },
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
      {
        flag: '--delay',
        name: 'delay',
        kind: 'float',
        label: 'Delay entre requests (s)',
        // 0.1s por cada 4 workers (factor 0.025) — mantiene la tasa agregada
        // contra Scryfall constante al cambiar "Workers".
        default: 0.1,
        help: 'Se ajusta solo al cambiar "Workers" (mantiene la tasa agregada contra Scryfall constante) — edítalo a mano si quieres desvincularlo.',
        linkedFrom: { arg: 'workers', factor: 0.025 },
      },
    ],
  },
  {
    id: 'shared-real-photos',
    group: 'shared',
    label: '03 · Fotos reales (Google Drive)',
    description:
      'Descarga el set de fotos reales de un mazo físico (Google Drive) usado para el chequeo end-to-end del scanner (no sintéticas, no renders). Idempotente: reutiliza lo que ya existe en disco. Usa el venv de pytorch/ (incluye gdown).',
    cwd: CERTAMEN_DIR,
    script: '03_real_photos_downloader.py',
    env: 'pytorch',
    args: [
      {
        flag: '--folder-id',
        name: 'folder_id',
        kind: 'string',
        label: 'ID de carpeta de Google Drive',
        default: '183WKHVHJ863hCJq3Kc9uHDJj3UFtC0pw',
      },
    ],
  },
  {
    id: 'shared-download-roboflow',
    group: 'shared',
    label: 'Fotos reales de daño (Roboflow) — Stage 4',
    description:
      'Descarga los dos datasets públicos de Roboflow (daño/desgaste en cartas) usados para reentrenar el clasificador de condición con fotos reales. Necesita una API key de Roboflow — configurala arriba. Idempotente. Usa el venv de pytorch/.',
    cwd: CERTAMEN2_DIR,
    script: 'download_roboflow_condition_data.py',
    env: 'pytorch',
    args: [],
  },
  {
    id: 'shared-download-negatives',
    group: 'shared',
    label: 'Descargar cartas negativas (Pokémon + otras fuentes + escenas genéricas)',
    description:
      'Descarga (o completa) las imágenes no-MTG usadas como negativos por el detector Stage 1 — Pokémon TCG, Yu-Gi-Oh!, Star Wars: Unlimited (sumada por ROADMAP.md I18 — confusión real encontrada en dispositivo, layout de carta parecido a MTG), "escenas genéricas" reales de Wikimedia Commons (cuartos, pantallas, TVs — sumada por ROADMAP.md I31, el caso real de un video en una pantalla detectado como carta; Commons rate-limita fuerte, puede tardar) y dos mazos de naipes. Idempotente: reutiliza lo que ya existe en disco y solo descarga lo que falta. Usa el venv de pytorch/ (compartida con TensorFlow: misma carpeta en disco).',
    cwd: PT_DIR,
    script: '07_binary_classifier.py',
    env: 'pytorch',
    args: [
      { flag: '--download-only', name: 'download_only', kind: 'boolean', label: 'download-only', default: true, hidden: true },
      { flag: '--n', name: 'n', kind: 'number', label: 'Cartas por clase', default: 3000 },
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

  // Preparación de datasets de certamen_2/ (pasos lentos de I/O — OCR,
  // descarga, desgaste sintético — separados del entrenamiento en sí, ver
  // los docstrings de cada script). Usan el venv 'certamen2' (C1 en
  // ROADMAP.md), no 'pytorch': son Python puro/OpenCV/sklearn, no necesitan
  // torch ni tensorflow instalados. Deliberadamente fuera de
  // RUN_ALL_SEQUENCES/RUN_ALL_DOWNLOAD_SEQUENCE — igual que shared-scraper
  // (regla 2 de CLAUDE.md), son pasos manuales de una sola vez, no algo para
  // re-correr sin pensar en cada "Correr todo" (prepare_text_validator_dataset.py
  // en particular re-muestrea cartas al azar cada vez que corre).
  {
    id: 'shared-prepare-text-validator',
    group: 'shared',
    label: 'Preparar dataset — Stage 2 (OCR + pares de texto)',
    description:
      'Descarga N cartas en calidad "large", corre OCR (tesseract) sobre el recorte de texto y arma pares (ocr_text, texto_referencia, label) balanceados 1:1 en certamen_2/data/text_pairs/index.csv. Paso lento — necesita tesseract instalado en el sistema. Usa el venv certamen2.',
    cwd: CERTAMEN2_DIR,
    script: 'prepare_text_validator_dataset.py',
    env: 'certamen2',
    args: [
      { flag: '--n', name: 'n', kind: 'number', label: 'Cartas a muestrear', default: 800 },
      {
        flag: '--quality',
        name: 'quality',
        kind: 'select',
        label: 'Calidad de descarga',
        options: ['normal', 'large', 'png'],
        default: 'large',
        recommended: 'large',
        help: '"small" no es una opción acá (a diferencia del scraper) — el texto tiene que ser legible para el OCR.',
      },
      { flag: '--seed', name: 'seed', kind: 'number', label: 'Seed', default: 42 },
    ],
  },
  {
    id: 'shared-prepare-price',
    group: 'shared',
    label: 'Preparar dataset — Stage 3 (tabular + split + escalador)',
    description:
      'Arma la mitad tabular del dataset de precio (cards.csv), el split train/val/test por card_id (split.json) y el escalador de features numéricas (tabular_scaler.json), todos bajo certamen_2/data/price_dataset/. No toca imágenes ni ningún backbone — eso lo hacen pytorch/prepare_price_embeddings.py y tensorFlow/prepare_price_embeddings.py después, cada uno en su propio venv. Usa el venv certamen2.',
    cwd: CERTAMEN2_DIR,
    script: 'prepare_price_dataset.py',
    env: 'certamen2',
    args: [
      { flag: '--n', name: 'n', kind: 'number', label: 'Sub-muestra (0 = todas las cartas con precio)', default: 0 },
      { flag: '--seed', name: 'seed', kind: 'number', label: 'Seed', default: 42 },
      { flag: '--val-split', name: 'val_split', kind: 'float', label: 'Fracción de validación', default: 0.15 },
      { flag: '--test-split', name: 'test_split', kind: 'float', label: 'Fracción de test', default: 0.15 },
    ],
  },
  {
    id: 'shared-prepare-condition',
    group: 'shared',
    label: 'Preparar dataset — Stage 4 (desgaste sintético)',
    description:
      'Bootstrap de datos para el clasificador de condición: por cada carta muestreada genera una versión por grado (NM/LP/MP/HP/DMG) con synthetic_wear.py, todas a partir de la misma imagen limpia. No reemplaza fotos reales (ver Roboflow, arriba) — es para tener algo entrenable antes de conseguir/etiquetar fotos reales. Usa el venv certamen2.',
    cwd: CERTAMEN2_DIR,
    script: 'prepare_condition_dataset.py',
    env: 'certamen2',
    args: [
      { flag: '--n', name: 'n', kind: 'number', label: 'Cartas base a muestrear', default: 500 },
      { flag: '--seed', name: 'seed', kind: 'number', label: 'Seed', default: 42 },
      // ROADMAP.md G4e (sleeve follow-up) — triplica el dataset con variantes
      // clear/colored (synthetic_sleeve.py). Default false: no cambiar el
      // comportamiento/reproducibilidad de corridas existentes ni de "Correr todo".
      { flag: '--con-fundas', name: 'con_fundas', kind: 'boolean', label: 'Incluir variantes con funda (clear/colored)', default: false },
    ],
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
      'Exporta el detector MTG/no-MTG ya entrenado (mtg_detector.pth) a ONNX, verificando que las salidas coincidan con el modelo original, y lo copia a trading-app-ionic/public/models/stage1-detector.onnx. No reentrena nada.',
    cwd: PT_DIR,
    script: '09_export_onnx.py',
    env: 'pytorch',
    args: [
      { flag: '--imagen', name: 'imagen', kind: 'file', label: 'Imagen de verificación (opcional, si no se usa un tensor aleatorio)' },
      { flag: '--opset', name: 'opset', kind: 'number', label: 'Versión de opset ONNX', default: 18 },
      { flag: '--tolerancia', name: 'tolerancia', kind: 'float', label: 'Tolerancia de verificación', default: 0.0001 },
      { flag: '--no-ionic-copy', name: 'no_ionic_copy', kind: 'boolean', label: 'No copiar a trading-app-ionic/public/models/', default: false },
    ],
  },
  {
    id: 'pt-export-onnx-condition',
    group: 'pytorch',
    label: '12 · Exportar clasificador de condición a ONNX (Stage 4)',
    description:
      'Exporta el clasificador de condición ya entrenado (condition_grader_combined.pth — el modelo real+sintético que predict_condition.py usa, no el sintético-solo) a ONNX, verificando que las salidas coincidan con el modelo original, y lo copia a trading-app-ionic/public/models/stage4-condition-grader.onnx. Requiere haber corrido "12 · Entrenar combinado" primero. No reentrena nada.',
    cwd: PT_DIR,
    script: '12_export_onnx_condition.py',
    env: 'pytorch',
    args: [
      { flag: '--imagen', name: 'imagen', kind: 'file', label: 'Imagen de verificación (opcional, si no se usa un tensor aleatorio)' },
      { flag: '--opset', name: 'opset', kind: 'number', label: 'Versión de opset ONNX', default: 18 },
      { flag: '--tolerancia', name: 'tolerancia', kind: 'float', label: 'Tolerancia de verificación', default: 0.0001 },
      { flag: '--no-ionic-copy', name: 'no_ionic_copy', kind: 'boolean', label: 'No copiar a trading-app-ionic/public/models/', default: false },
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

  // ── PyTorch — Stage 2: Validador de texto (OCR match) ──────────────────
  {
    id: 'pt-text-validator',
    group: 'pytorch',
    label: '14 · Entrenar validador de texto',
    description: 'Entrena el MLP que compara texto OCR contra el texto de referencia (hashed n-grams). Requiere el dataset preparado por certamen_2/prepare_text_validator_dataset.py.',
    cwd: PT_DIR,
    script: '14_text_validator.py',
    env: 'pytorch',
    args: [
      { flag: '--epochs', name: 'epochs', kind: 'number', label: 'Épocas', default: 20 },
      { flag: '--hidden-units', name: 'hidden_units', kind: 'number', label: 'Unidades ocultas', default: 256 },
      { flag: '--dropout', name: 'dropout', kind: 'float', label: 'Dropout', default: 0.3 },
      { flag: '--lr', name: 'lr', kind: 'float', label: 'Learning rate', default: 0.001 },
      { flag: '--weight-decay', name: 'weight_decay', kind: 'float', label: 'Weight decay', default: 0.0001 },
      { flag: '--optimizer', name: 'optimizer', kind: 'select', label: 'Optimizador', options: ['adam', 'adamw', 'sgd'], default: 'adamw', recommended: 'adamw' },
      // Regla dura #1 de CLAUDE.md: TextMatcher (nn.Linear(2048,256)) puede
      // segfaultear en ROCm/MIOpen en algunas GPU AMD — flag opt-in, nunca
      // default a CPU para no desactivar la aceleración a todo el resto.
      { flag: '--device', name: 'device', kind: 'select', label: 'Device', options: ['auto', 'cpu', 'cuda'], default: 'auto', recommended: 'auto', help: 'Cambiar a "cpu" solo si esta máquina sufre el segfault de ROCm/MIOpen descrito en CLAUDE.md.' },
    ],
  },
  {
    id: 'pt-optuna-text-validator',
    group: 'pytorch',
    label: '15 · Búsqueda de hiperparámetros (Optuna)',
    description: 'Optimiza el validador de texto con Optuna. Puede tardar mucho según --trials.',
    cwd: PT_DIR,
    script: '15_optuna_text_validator.py',
    env: 'pytorch',
    args: [
      { flag: '--trials', name: 'trials', kind: 'number', label: 'Cantidad de trials', default: 20 },
      { flag: '--trial-epochs', name: 'trial_epochs', kind: 'number', label: 'Épocas por trial', default: 10 },
      { flag: '--final-epochs', name: 'final_epochs', kind: 'number', label: 'Épocas del entrenamiento final', default: 20 },
      { flag: '--timeout-hours', name: 'timeout_hours', kind: 'float', label: 'Timeout (horas, opcional)' },
      { flag: '--study-name', name: 'study_name', kind: 'string', label: 'Nombre del estudio Optuna', default: 'text_validator_pytorch' },
      { flag: '--resume-dir', name: 'resume_dir', kind: 'string', label: 'Retomar estudio desde (ruta, opcional)' },
      { flag: '--seed', name: 'seed', kind: 'number', label: 'Seed', default: 42 },
      { flag: '--device', name: 'device', kind: 'select', label: 'Device', options: ['auto', 'cpu', 'cuda'], default: 'auto', recommended: 'auto', help: 'Cambiar a "cpu" solo si esta máquina sufre el segfault de ROCm/MIOpen descrito en CLAUDE.md.' },
      { flag: '--no-final-train', name: 'no_final_train', kind: 'boolean', label: 'No entrenar el modelo final', default: false },
    ],
    resultFiles: () => [
      { kind: 'optuna', label: 'Optuna — PyTorch', path: path.join(CERTAMEN_DIR, 'output', 'pytorch', 'optuna_text_validator', 'latest', 'best_params.json') },
    ],
  },
  {
    id: 'pt-export-onnx-text-validator',
    group: 'pytorch',
    label: '16 · Exportar validador de texto a ONNX (Stage 2)',
    description:
      'Exporta el validador de texto ya entrenado (text_matcher.pth) a ONNX, verificando que las salidas coincidan con el modelo original, y lo copia a trading-app-ionic/public/models/stage2-text-validator.onnx. No reentrena nada.',
    cwd: PT_DIR,
    script: '16_export_onnx_text_validator.py',
    env: 'pytorch',
    args: [
      { flag: '--ocr-text', name: 'ocr_text', kind: 'string', label: 'Texto OCR real de verificación (opcional, si no se usa un tensor aleatorio)' },
      { flag: '--ref-text', name: 'ref_text', kind: 'string', label: 'Texto de referencia de verificación (opcional)' },
      { flag: '--opset', name: 'opset', kind: 'number', label: 'Versión de opset ONNX', default: 18 },
      { flag: '--tolerancia', name: 'tolerancia', kind: 'float', label: 'Tolerancia de verificación', default: 0.0001 },
      { flag: '--no-ionic-copy', name: 'no_ionic_copy', kind: 'boolean', label: 'No copiar a trading-app-ionic/public/models/', default: false },
    ],
  },

  // ── PyTorch — Stage 3: Estimador de precio ──────────────────────────────
  {
    id: 'pt-price-estimator',
    group: 'pytorch',
    label: '15 · Entrenar estimador de precio',
    description:
      'Entrena el regresor de precio (tabular + embedding visual congelado de Stage 1) sobre log1p(price). Requiere certamen_2/prepare_price_dataset.py y pytorch/prepare_price_embeddings.py ya corridos.',
    cwd: PT_DIR,
    script: '15_price_estimator.py',
    env: 'pytorch',
    args: [
      { flag: '--epochs', name: 'epochs', kind: 'number', label: 'Épocas', default: 40 },
      { flag: '--hidden-units', name: 'hidden_units', kind: 'number', label: 'Unidades ocultas', default: 256 },
      { flag: '--dropout', name: 'dropout', kind: 'float', label: 'Dropout', default: 0.3 },
      { flag: '--lr', name: 'lr', kind: 'float', label: 'Learning rate', default: 0.001 },
      { flag: '--weight-decay', name: 'weight_decay', kind: 'float', label: 'Weight decay', default: 0.0001 },
      { flag: '--optimizer', name: 'optimizer', kind: 'select', label: 'Optimizador', options: ['adam', 'adamw', 'sgd'], default: 'adamw', recommended: 'adamw' },
      // Regla dura #1 de CLAUDE.md: mismo criterio que pt-text-validator — opt-in, nunca default a CPU.
      { flag: '--device', name: 'device', kind: 'select', label: 'Device', options: ['auto', 'cpu', 'cuda'], default: 'auto', recommended: 'auto', help: 'Cambiar a "cpu" solo si esta máquina sufre el segfault de ROCm/MIOpen descrito en CLAUDE.md.' },
    ],
    resultFiles: () => [
      { kind: 'metrics', label: 'Métricas — PyTorch', path: path.join(CERTAMEN_DIR, 'output', 'pytorch', 'price_estimator', 'latest', 'metrics_price_estimator.json') },
    ],
  },
  {
    id: 'pt-optuna-price-estimator',
    group: 'pytorch',
    label: '17 · Búsqueda de hiperparámetros (Optuna)',
    description: 'Optimiza el estimador de precio con Optuna. Puede tardar mucho según --trials.',
    cwd: PT_DIR,
    script: '17_optuna_price_estimator.py',
    env: 'pytorch',
    args: [
      { flag: '--trials', name: 'trials', kind: 'number', label: 'Cantidad de trials', default: 20 },
      { flag: '--trial-epochs', name: 'trial_epochs', kind: 'number', label: 'Épocas por trial', default: 10 },
      { flag: '--final-epochs', name: 'final_epochs', kind: 'number', label: 'Épocas del entrenamiento final', default: 40 },
      { flag: '--timeout-hours', name: 'timeout_hours', kind: 'float', label: 'Timeout (horas, opcional)' },
      { flag: '--study-name', name: 'study_name', kind: 'string', label: 'Nombre del estudio Optuna', default: 'price_estimator_pytorch' },
      { flag: '--resume-dir', name: 'resume_dir', kind: 'string', label: 'Retomar estudio desde (ruta, opcional)' },
      { flag: '--seed', name: 'seed', kind: 'number', label: 'Seed', default: 42 },
      { flag: '--device', name: 'device', kind: 'select', label: 'Device', options: ['auto', 'cpu', 'cuda'], default: 'auto', recommended: 'auto', help: 'Cambiar a "cpu" solo si esta máquina sufre el segfault de ROCm/MIOpen descrito en CLAUDE.md.' },
      { flag: '--no-final-train', name: 'no_final_train', kind: 'boolean', label: 'No entrenar el modelo final', default: false },
    ],
    resultFiles: () => [
      { kind: 'optuna', label: 'Optuna — PyTorch', path: path.join(CERTAMEN_DIR, 'output', 'pytorch', 'optuna_price_estimator', 'latest', 'best_params.json') },
      { kind: 'metrics', label: 'Modelo final — PyTorch', path: path.join(CERTAMEN_DIR, 'output', 'pytorch', 'optuna_price_estimator', 'latest', 'final_metrics.json') },
    ],
  },
  {
    id: 'pt-export-onnx-price-estimator',
    group: 'pytorch',
    label: '18 · Exportar estimador de precio a ONNX (Stage 3)',
    description:
      'Exporta el estimador de precio ya entrenado (price_regressor.pth) a ONNX, verificando paridad numérica contra el modelo original (salida cruda log1p(price), sin sigmoid), y lo copia a trading-app-ionic/public/models/stage3-price-estimator.onnx. No reentrena nada.',
    cwd: PT_DIR,
    script: '18_export_onnx_price_estimator.py',
    env: 'pytorch',
    args: [
      { flag: '--opset', name: 'opset', kind: 'number', label: 'Versión de opset ONNX', default: 18 },
      { flag: '--tolerancia', name: 'tolerancia', kind: 'float', label: 'Tolerancia de verificación', default: 0.0001 },
      { flag: '--no-ionic-copy', name: 'no_ionic_copy', kind: 'boolean', label: 'No copiar a trading-app-ionic/public/models/', default: false },
    ],
  },
  {
    id: 'pt-export-onnx-price-embedding',
    group: 'pytorch',
    label: '19 · Exportar embedding visual de Stage 1 a ONNX (para Stage 3)',
    description:
      'Exporta solo el extractor de embedding visual congelado de Stage 1 (MTGDetector.features→avgpool→flatten, 1280 dims, mismo checkpoint que 09_export_onnx.py pero sin la cabeza de clasificación) a ONNX, para que la app Ionic pueda calcular la mitad visual del vector de Stage 3 del lado del cliente. No reentrena nada. TensorFlow no tiene equivalente — el cliente Ionic usa el embedding de PyTorch para ambos casos (ROADMAP.md E2).',
    cwd: PT_DIR,
    script: '19_export_onnx_price_embedding.py',
    env: 'pytorch',
    args: [
      { flag: '--imagen', name: 'imagen', kind: 'file', label: 'Imagen de verificación (opcional, si no se usa un tensor aleatorio)', help: 'Recomendado: una foto real da paridad ~1e-6; el tensor aleatorio por defecto da ~1e-4, cerca del límite de tolerancia.' },
      { flag: '--opset', name: 'opset', kind: 'number', label: 'Versión de opset ONNX', default: 18 },
      { flag: '--tolerancia', name: 'tolerancia', kind: 'float', label: 'Tolerancia de verificación', default: 0.0002 },
      { flag: '--no-ionic-copy', name: 'no_ionic_copy', kind: 'boolean', label: 'No copiar a trading-app-ionic/public/models/', default: false },
    ],
  },

  // ── PyTorch — Stage 4: Clasificador de condición ────────────────────────
  {
    id: 'pt-condition-grader',
    group: 'pytorch',
    label: '10 · Entrenar clasificador de condición',
    description: 'Entrena el clasificador de condición (NM/LP/MP/HP/DMG) sobre desgaste sintético. Requiere el dataset preparado por certamen_2/prepare_condition_dataset.py.',
    cwd: PT_DIR,
    script: '10_condition_grader.py',
    env: 'pytorch',
    args: [
      { flag: '--n', name: 'n', kind: 'number', label: 'Cartas base (0 = todas)', default: 0 },
      { flag: '--epochs', name: 'epochs', kind: 'number', label: 'Épocas', default: 15 },
    ],
  },
  {
    id: 'pt-optuna-condition-grader',
    group: 'pytorch',
    label: '11 · Búsqueda de hiperparámetros (Optuna)',
    description: 'Optimiza el clasificador de condición con Optuna. Puede tardar mucho según --trials.',
    cwd: PT_DIR,
    script: '11_optuna_condition_grader.py',
    env: 'pytorch',
    args: [
      { flag: '--n', name: 'n', kind: 'number', label: 'Cartas base (0 = todas)', default: 0 },
      { flag: '--trials', name: 'trials', kind: 'number', label: 'Cantidad de trials', default: 20 },
      { flag: '--trial-epochs', name: 'trial_epochs', kind: 'number', label: 'Épocas por trial', default: 6 },
      { flag: '--final-epochs', name: 'final_epochs', kind: 'number', label: 'Épocas del entrenamiento final', default: 15 },
      { flag: '--timeout-hours', name: 'timeout_hours', kind: 'float', label: 'Timeout (horas, opcional)' },
      { flag: '--study-name', name: 'study_name', kind: 'string', label: 'Nombre del estudio Optuna', default: 'condition_grader_pytorch' },
      { flag: '--resume-dir', name: 'resume_dir', kind: 'string', label: 'Retomar estudio desde (ruta, opcional)' },
      { flag: '--seed', name: 'seed', kind: 'number', label: 'Seed', default: 42 },
      { flag: '--no-final-train', name: 'no_final_train', kind: 'boolean', label: 'No entrenar el modelo final', default: false },
    ],
    resultFiles: () => [
      { kind: 'optuna', label: 'Optuna — PyTorch', path: path.join(CERTAMEN_DIR, 'output', 'pytorch', 'optuna_condition', 'latest', 'best_params.json') },
    ],
  },
  {
    id: 'pt-condition-grader-combined',
    group: 'pytorch',
    label: '12 · Entrenar combinado (sintético + fotos reales)',
    description:
      'Reentrena el clasificador de condición agregando 1,184 fotos reales de Roboflow (ver certamen_2/import_roboflow_condition_data.py) al desgaste sintético — genera condition_grader_combined.pth, el modelo que de verdad generaliza a fotos reales (72.2% vs 38.7% del sintético-solo, ver certamen_2/README.md sección 9) y el que usa "Testear" más abajo.',
    cwd: PT_DIR,
    script: '12_condition_grader_combined.py',
    env: 'pytorch',
    args: [{ flag: '--epochs', name: 'epochs', kind: 'number', label: 'Épocas', default: 15 }],
  },
  {
    id: 'pt-predict-condition',
    group: 'pytorch',
    label: 'Testear · Clasificar condición de una carta',
    description: 'Clasifica la condición (NM/LP/MP/HP/DMG) de una foto ya recortada/normalizada, usando condition_grader_combined.pth (ver "12 · Entrenar combinado" arriba).',
    cwd: PT_DIR,
    script: 'predict_condition.py',
    env: 'pytorch',
    args: [{ flag: null, name: 'imagen', kind: 'file', label: 'Imagen de la carta (recortada/normalizada)', required: true }],
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
    id: 'tf-export-onnx',
    group: 'tensorflow',
    label: '09 · Exportar a ONNX',
    description:
      'Exporta el detector MTG/no-MTG ya entrenado (mtg_detector.keras) a ONNX vía tf2onnx, verificando que las salidas coincidan con el modelo original, y lo copia a trading-app-ionic/public/models/stage1-detector.onnx. No reentrena nada.',
    cwd: TF_DIR,
    script: '09_export_onnx.py',
    env: 'tensorflow',
    args: [
      { flag: '--imagen', name: 'imagen', kind: 'file', label: 'Imagen de verificación (opcional, si no se usa un array aleatorio)' },
      { flag: '--opset', name: 'opset', kind: 'number', label: 'Versión de opset ONNX', default: 18 },
      { flag: '--tolerancia', name: 'tolerancia', kind: 'float', label: 'Tolerancia de verificación', default: 0.0001 },
      { flag: '--no-ionic-copy', name: 'no_ionic_copy', kind: 'boolean', label: 'No copiar a trading-app-ionic/public/models/', default: false },
    ],
  },
  {
    id: 'tf-export-onnx-condition',
    group: 'tensorflow',
    label: '11 · Exportar clasificador de condición a ONNX (Stage 4)',
    description:
      'Exporta el clasificador de condición ya entrenado (condition_grader.keras) a ONNX vía tf2onnx, verificando paridad numérica, y lo copia a trading-app-ionic/public/models/stage4-condition-grader.onnx. No reentrena nada.',
    cwd: TF_DIR,
    script: '11_export_onnx_condition.py',
    env: 'tensorflow',
    args: [
      { flag: '--imagen', name: 'imagen', kind: 'file', label: 'Imagen de verificación (opcional, si no se usa un array aleatorio)' },
      { flag: '--opset', name: 'opset', kind: 'number', label: 'Versión de opset ONNX', default: 18 },
      { flag: '--tolerancia', name: 'tolerancia', kind: 'float', label: 'Tolerancia de verificación', default: 0.0001 },
      { flag: '--no-ionic-copy', name: 'no_ionic_copy', kind: 'boolean', label: 'No copiar a trading-app-ionic/public/models/', default: false },
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

  // ── TensorFlow — Stage 2: Validador de texto (OCR match) ───────────────
  {
    id: 'tf-text-validator',
    group: 'tensorflow',
    label: '12 · Entrenar validador de texto',
    description: 'Entrena el MLP que compara texto OCR contra el texto de referencia (hashed n-grams). Requiere el dataset preparado por certamen_2/prepare_text_validator_dataset.py.',
    cwd: TF_DIR,
    script: '12_text_validator.py',
    env: 'tensorflow',
    args: [
      { flag: '--epochs', name: 'epochs', kind: 'number', label: 'Épocas', default: 20 },
      { flag: '--hidden-units', name: 'hidden_units', kind: 'number', label: 'Unidades ocultas', default: 256 },
      { flag: '--dropout', name: 'dropout', kind: 'float', label: 'Dropout', default: 0.3 },
      { flag: '--lr', name: 'lr', kind: 'float', label: 'Learning rate', default: 0.001 },
      { flag: '--weight-decay', name: 'weight_decay', kind: 'float', label: 'Weight decay', default: 0.0001 },
      { flag: '--optimizer', name: 'optimizer', kind: 'select', label: 'Optimizador', options: ['adam', 'adamw', 'sgd'], default: 'adamw', recommended: 'adamw' },
    ],
  },
  {
    id: 'tf-optuna-text-validator',
    group: 'tensorflow',
    label: '13 · Búsqueda de hiperparámetros (Optuna)',
    description: 'Optimiza el validador de texto con Optuna. Puede tardar mucho según --trials.',
    cwd: TF_DIR,
    script: '13_optuna_text_validator.py',
    env: 'tensorflow',
    args: [
      { flag: '--trials', name: 'trials', kind: 'number', label: 'Cantidad de trials', default: 20 },
      { flag: '--trial-epochs', name: 'trial_epochs', kind: 'number', label: 'Épocas por trial', default: 10 },
      { flag: '--final-epochs', name: 'final_epochs', kind: 'number', label: 'Épocas del entrenamiento final', default: 20 },
      { flag: '--timeout-hours', name: 'timeout_hours', kind: 'float', label: 'Timeout (horas, opcional)' },
      { flag: '--study-name', name: 'study_name', kind: 'string', label: 'Nombre del estudio Optuna', default: 'text_validator_tensorflow' },
      { flag: '--resume-dir', name: 'resume_dir', kind: 'string', label: 'Retomar estudio desde (ruta, opcional)' },
      { flag: '--seed', name: 'seed', kind: 'number', label: 'Seed', default: 42 },
      { flag: '--no-final-train', name: 'no_final_train', kind: 'boolean', label: 'No entrenar el modelo final', default: false },
    ],
    resultFiles: () => [
      { kind: 'optuna', label: 'Optuna — TensorFlow', path: path.join(CERTAMEN_DIR, 'output', 'tensorflow', 'optuna_text_validator', 'latest', 'best_params.json') },
    ],
  },
  {
    id: 'tf-export-onnx-text-validator',
    group: 'tensorflow',
    label: '14 · Exportar validador de texto a ONNX (Stage 2)',
    description:
      'Exporta el validador de texto ya entrenado (text_matcher.keras) a ONNX vía tf2onnx, verificando paridad numérica, y lo copia a trading-app-ionic/public/models/stage2-text-validator.onnx. No reentrena nada.',
    cwd: TF_DIR,
    script: '14_export_onnx_text_validator.py',
    env: 'tensorflow',
    args: [
      { flag: '--ocr-text', name: 'ocr_text', kind: 'string', label: 'Texto OCR real de verificación (opcional, si no se usa un array aleatorio)' },
      { flag: '--ref-text', name: 'ref_text', kind: 'string', label: 'Texto de referencia de verificación (opcional)' },
      { flag: '--opset', name: 'opset', kind: 'number', label: 'Versión de opset ONNX', default: 18 },
      { flag: '--tolerancia', name: 'tolerancia', kind: 'float', label: 'Tolerancia de verificación', default: 0.0001 },
      { flag: '--no-ionic-copy', name: 'no_ionic_copy', kind: 'boolean', label: 'No copiar a trading-app-ionic/public/models/', default: false },
    ],
  },

  // ── TensorFlow — Stage 3: Estimador de precio ───────────────────────────
  {
    id: 'tf-price-estimator',
    group: 'tensorflow',
    label: '13 · Entrenar estimador de precio',
    description:
      'Entrena el regresor de precio (tabular + embedding visual congelado de Stage 1) sobre log1p(price). Requiere certamen_2/prepare_price_dataset.py y tensorFlow/prepare_price_embeddings.py ya corridos.',
    cwd: TF_DIR,
    script: '13_price_estimator.py',
    env: 'tensorflow',
    args: [
      { flag: '--epochs', name: 'epochs', kind: 'number', label: 'Épocas', default: 40 },
      { flag: '--hidden-units', name: 'hidden_units', kind: 'number', label: 'Unidades ocultas', default: 256 },
      { flag: '--dropout', name: 'dropout', kind: 'float', label: 'Dropout', default: 0.3 },
      { flag: '--lr', name: 'lr', kind: 'float', label: 'Learning rate', default: 0.001 },
      { flag: '--weight-decay', name: 'weight_decay', kind: 'float', label: 'Weight decay', default: 0.0001 },
      { flag: '--optimizer', name: 'optimizer', kind: 'select', label: 'Optimizador', options: ['adam', 'adamw', 'sgd'], default: 'adamw', recommended: 'adamw' },
      { flag: '--batch-size', name: 'batch_size', kind: 'number', label: 'Batch size', default: 64 },
    ],
    resultFiles: () => [
      { kind: 'metrics', label: 'Métricas — TensorFlow', path: path.join(CERTAMEN_DIR, 'output', 'tensorflow', 'price_estimator', 'latest', 'metrics_price_estimator.json') },
    ],
  },
  {
    id: 'tf-optuna-price-estimator',
    group: 'tensorflow',
    label: '15 · Búsqueda de hiperparámetros (Optuna)',
    description: 'Optimiza el estimador de precio con Optuna. Puede tardar mucho según --trials.',
    cwd: TF_DIR,
    script: '15_optuna_price_estimator.py',
    env: 'tensorflow',
    args: [
      { flag: '--trials', name: 'trials', kind: 'number', label: 'Cantidad de trials', default: 20 },
      { flag: '--trial-epochs', name: 'trial_epochs', kind: 'number', label: 'Épocas por trial', default: 10 },
      { flag: '--final-epochs', name: 'final_epochs', kind: 'number', label: 'Épocas del entrenamiento final', default: 40 },
      { flag: '--timeout-hours', name: 'timeout_hours', kind: 'float', label: 'Timeout (horas, opcional)' },
      { flag: '--study-name', name: 'study_name', kind: 'string', label: 'Nombre del estudio Optuna', default: 'price_estimator_tensorflow' },
      { flag: '--resume-dir', name: 'resume_dir', kind: 'string', label: 'Retomar estudio desde (ruta, opcional)' },
      { flag: '--seed', name: 'seed', kind: 'number', label: 'Seed', default: 42 },
      { flag: '--no-final-train', name: 'no_final_train', kind: 'boolean', label: 'No entrenar el modelo final', default: false },
    ],
    resultFiles: () => [
      { kind: 'optuna', label: 'Optuna — TensorFlow', path: path.join(CERTAMEN_DIR, 'output', 'tensorflow', 'optuna_price_estimator', 'latest', 'best_params.json') },
      { kind: 'metrics', label: 'Modelo final — TensorFlow', path: path.join(CERTAMEN_DIR, 'output', 'tensorflow', 'optuna_price_estimator', 'latest', 'final_metrics.json') },
    ],
  },
  {
    id: 'tf-export-onnx-price-estimator',
    group: 'tensorflow',
    label: '16 · Exportar estimador de precio a ONNX (Stage 3)',
    description:
      'Exporta el estimador de precio ya entrenado (price_regressor.keras) a ONNX vía tf2onnx, verificando paridad numérica (salida cruda log1p(price), sin sigmoid), y lo copia a trading-app-ionic/public/models/stage3-price-estimator.onnx. No reentrena nada.',
    cwd: TF_DIR,
    script: '16_export_onnx_price_estimator.py',
    env: 'tensorflow',
    args: [
      { flag: '--opset', name: 'opset', kind: 'number', label: 'Versión de opset ONNX', default: 18 },
      { flag: '--tolerancia', name: 'tolerancia', kind: 'float', label: 'Tolerancia de verificación', default: 0.0001 },
      { flag: '--no-ionic-copy', name: 'no_ionic_copy', kind: 'boolean', label: 'No copiar a trading-app-ionic/public/models/', default: false },
    ],
  },

  // ── TensorFlow — Stage 4: Clasificador de condición ─────────────────────
  {
    id: 'tf-condition-grader',
    group: 'tensorflow',
    label: '09 · Entrenar clasificador de condición',
    description: 'Entrena el clasificador de condición (NM/LP/MP/HP/DMG) sobre desgaste sintético. Requiere el dataset preparado por certamen_2/prepare_condition_dataset.py.',
    cwd: TF_DIR,
    script: '09_condition_grader.py',
    env: 'tensorflow',
    args: [
      { flag: '--n', name: 'n', kind: 'number', label: 'Cartas base (0 = todas)', default: 0 },
      { flag: '--epochs', name: 'epochs', kind: 'number', label: 'Épocas', default: 15 },
    ],
  },
  {
    id: 'tf-optuna-condition-grader',
    group: 'tensorflow',
    label: '10 · Búsqueda de hiperparámetros (Optuna)',
    description: 'Optimiza el clasificador de condición con Optuna. Puede tardar mucho según --trials.',
    cwd: TF_DIR,
    script: '10_optuna_condition_grader.py',
    env: 'tensorflow',
    args: [
      { flag: '--n', name: 'n', kind: 'number', label: 'Cartas base (0 = todas)', default: 0 },
      { flag: '--trials', name: 'trials', kind: 'number', label: 'Cantidad de trials', default: 20 },
      { flag: '--trial-epochs', name: 'trial_epochs', kind: 'number', label: 'Épocas por trial', default: 6 },
      { flag: '--final-epochs', name: 'final_epochs', kind: 'number', label: 'Épocas del entrenamiento final', default: 15 },
      { flag: '--timeout-hours', name: 'timeout_hours', kind: 'float', label: 'Timeout (horas, opcional)' },
      { flag: '--study-name', name: 'study_name', kind: 'string', label: 'Nombre del estudio Optuna', default: 'condition_grader_tensorflow' },
      { flag: '--resume-dir', name: 'resume_dir', kind: 'string', label: 'Retomar estudio desde (ruta, opcional)' },
      { flag: '--seed', name: 'seed', kind: 'number', label: 'Seed', default: 42 },
      { flag: '--no-final-train', name: 'no_final_train', kind: 'boolean', label: 'No entrenar el modelo final', default: false },
    ],
    resultFiles: () => [
      { kind: 'optuna', label: 'Optuna — TensorFlow', path: path.join(CERTAMEN_DIR, 'output', 'tensorflow', 'optuna_condition', 'latest', 'best_params.json') },
    ],
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
 * no por framework. Entrena las 4 stages con sus hiperparámetros default; la
 * búsqueda de Optuna de cada stage queda como acción manual aparte (son
 * corridas largas, no tiene sentido meterlas en el camino automático de
 * "correr todo"). Stage 3 (`pt-price-estimator`/`tf-price-estimator`)
 * requiere que `certamen_2/prepare_price_dataset.py` y
 * `{pytorch,tensorFlow}/prepare_price_embeddings.py` ya hayan corrido — no
 * son parte de esta secuencia todavía (siguen sin venv registrado, ver
 * ROADMAP.md workstream C, item C1).
 */
export const RUN_ALL_SEQUENCES: Record<'pytorch' | 'tensorflow', string[]> = {
  pytorch: ['pt-embedder', 'shared-evaluate', 'pt-visualize', 'pt-binary-classifier', 'pt-text-validator', 'pt-price-estimator', 'pt-condition-grader'],
  tensorflow: ['tf-embeddings', 'shared-evaluate', 'tf-visualize', 'tf-binary-classifier', 'tf-text-validator', 'tf-price-estimator', 'tf-condition-grader'],
};

/**
 * Fase de descarga de "Correr TODO" — deliberadamente solo `shared-downloader`,
 * NUNCA `shared-scraper`. `01_scraper.py` sobreescribe data/cards.json entero en
 * cada corrida, truncado a `--max-cards` (default 5,000 en esta UI) — si
 * "Correr TODO" incluyera el scraper con sus defaults, cada corrida automática
 * podría pisar silenciosamente el dataset completo (58k+ impresiones) con una
 * versión de 5,000. `shared-downloader` en cambio es puramente idempotente
 * (reusa lo que ya está en disco, ver 02_downloader.py) — siempre seguro de
 * re-correr. Re-scrapear sigue siendo un botón manual aparte en la pestaña
 * "Scraper" para cuando de verdad hace falta. `shared-real-photos` es igual
 * de seguro de incluir — también puramente idempotente (03_real_photos_downloader.py).
 */
export const RUN_ALL_DOWNLOAD_SEQUENCE: string[] = ['shared-downloader', 'shared-real-photos'];

/**
 * Fase final de "Correr TODO" — exporta a ONNX todo lo que ya está entrenado
 * en ambos frameworks (todas las etapas registradas hoy: Stage 1, 2, 3 y 4).
 * Los scripts de export no reentrenan nada, solo leen el checkpoint que las
 * fases pytorch/tensorflow de arriba acaban de dejar guardado.
 *
 * Stage 1/2/4 son intercambiables acá — ambos frameworks publican el mismo
 * contrato de entrada/salida bajo el mismo nombre público, así que "el
 * último que corre gana" es inofensivo (`ExportPanel.tsx` deja elegir cuál
 * de los dos queda). **Stage 3 es la excepción, orden importa** (ROADMAP.md
 * E2, 16 ago): `stage3-price-estimator.onnx` de PyTorch espera un input de
 * 1330 dims (50 tabular + 1280 visual, `stage1-embedder.onnx`), el de
 * TensorFlow espera 626 (50 + 576) — no son intercambiables, y
 * TensorFlow no tiene ningún export equivalente a `stage1-embedder.onnx`
 * (`19_export_onnx_price_embedding.py` es PyTorch-only). `stage3Price
 * Estimator.ts` solo sabe construir el input de 1280-dim, así que el
 * TensorFlow de Stage 3 nunca es utilizable del lado del cliente — por eso
 * `tf-export-onnx-price-estimator` corre ANTES que el par PyTorch acá,
 * a propósito, para que el archivo que quede publicado al final de la
 * secuencia sea siempre el de PyTorch, nunca el de TensorFlow.
 */
export const RUN_ALL_EXPORT_SEQUENCE: string[] = [
  'pt-export-onnx',
  'tf-export-onnx',
  'pt-export-onnx-text-validator',
  'tf-export-onnx-text-validator',
  'tf-export-onnx-price-estimator',
  'pt-export-onnx-price-estimator',
  'pt-export-onnx-price-embedding',
  // Stage 4 is TF-then-PT, same exception/reasoning as Stage 3 above:
  // PyTorch's combined (real+synthetic) checkpoint significantly outperforms
  // TensorFlow's (accuracy 0.8615/F1-macro 0.8535 vs. 0.6571/0.6368, measured
  // 17 ago when TF's own combined-checkpoint script — 11_condition_grader_
  // combined.py, ROADMAP.md I20 item 2 — first started existing/being
  // runnable) — "last export wins" would otherwise leave the weaker
  // TensorFlow model live in Ionic on every future "Correr Todo" run.
  'tf-export-onnx-condition',
  'pt-export-onnx-condition',
];

export function findScript(id: string): ScriptDef | undefined {
  return SCRIPTS.find((s) => s.id === id);
}

// ── Comparación PyTorch vs TensorFlow para la pestaña "Exportar" ──────────

export type ComparableFramework = 'pytorch' | 'tensorflow';

export interface StageComparisonDef {
  /** Identificador estable de la etapa (no es el nombre del script). */
  stage: 'stage1' | 'stage2' | 'stage3' | 'stage4';
  label: string;
  /**
   * Campo de final_metrics.json que decide qué framework "gana" — admite un
   * path con puntos (ej. "log_space.r2") para métricas anidadas como las de
   * Stage 3 (ver getExportComparison() en scripts.service.ts, que resuelve
   * el path en vez de una key plana).
   */
  metricKey: string;
  metricLabel: string;
  /**
   * Cómo mostrar metricKey (y las métricas secundarias de esa misma etapa)
   * en la pestaña "Exportar" — 'percent' (default, ej. 92.30%) tiene sentido
   * para accuracy/ROC-AUC/F1 (0..1 = fracción), pero no para R² de Stage 3:
   * aunque también cae en 0..1 para un modelo decente, mostrarlo como
   * "44.10%" en vez de "0.441" es una lectura rara para un R² — 'decimal'
   * lo muestra tal cual. Ver ExportPanel.tsx (renderer) donde se consume.
   */
  format?: 'percent' | 'decimal';
  metricsPath: (fw: ComparableFramework) => string;
  exportScriptId: (fw: ComparableFramework) => string;
}

/**
 * Las 4 stages entrenan en los dos frameworks. Los paths apuntan a
 * output/<framework>/<optuna_dir>/latest/final_metrics.json, que
 * 08_optuna_binary_classifier.py / 15_optuna_text_validator.py /
 * 17_optuna_price_estimator.py / 11_optuna_condition_grader.py (pytorch) y
 * sus equivalentes de tensorFlow/ escriben al terminar una corrida con
 * entrenamiento final (--no-final-train los deja sin generar).
 */
export const EXPORT_STAGES: StageComparisonDef[] = [
  {
    stage: 'stage1',
    label: 'Stage 1 — Detector MTG / no-MTG',
    metricKey: 'accuracy',
    metricLabel: 'Accuracy',
    metricsPath: (fw) => path.join(CERTAMEN_DIR, 'output', fw, 'optuna', 'latest', 'final_metrics.json'),
    exportScriptId: (fw) => (fw === 'pytorch' ? 'pt-export-onnx' : 'tf-export-onnx'),
  },
  {
    stage: 'stage2',
    label: 'Stage 2 — Validador de texto (OCR match)',
    metricKey: 'roc_auc',
    metricLabel: 'ROC-AUC',
    metricsPath: (fw) => path.join(CERTAMEN_DIR, 'output', fw, 'optuna_text_validator', 'latest', 'final_metrics.json'),
    exportScriptId: (fw) => (fw === 'pytorch' ? 'pt-export-onnx-text-validator' : 'tf-export-onnx-text-validator'),
  },
  {
    stage: 'stage3',
    label: 'Stage 3 — Estimador de precio',
    // R² en log-espacio (log1p(price)), no MAE/RMSE ni el R² en USD-espacio:
    // (a) mantiene "el número más grande gana" sin agregarle a
    // getExportComparison() una noción de "más chico es mejor" que hoy no
    // existe (MAE/RMSE la necesitarían, R² no); (b) el R² en USD-espacio es
    // el que de verdad importa para el usuario final pero sale casi-cero
    // (0.02–0.12, ver ROADMAP.md H3) por el sesgo/outliers de precio — un
    // artefacto esperado, no comparable de forma justa entre frameworks:
    // ver certamen_2/README.md y el propio ROADMAP.md, workstream B.
    metricKey: 'log_space.r2',
    metricLabel: 'R² (log-USD)',
    format: 'decimal',
    metricsPath: (fw) => path.join(CERTAMEN_DIR, 'output', fw, 'optuna_price_estimator', 'latest', 'final_metrics.json'),
    exportScriptId: (fw) => (fw === 'pytorch' ? 'pt-export-onnx-price-estimator' : 'tf-export-onnx-price-estimator'),
  },
  {
    stage: 'stage4',
    label: 'Stage 4 — Clasificador de condición (NM/LP/MP/HP/DMG)',
    // f1_macro (no accuracy) porque acá importa el desempeño parejo entre
    // las 5 clases de condición, no solo el total de aciertos — con clases
    // no perfectamente balanceadas, accuracy sola puede esconder que un
    // framework falla sistemáticamente en un grado en particular.
    metricKey: 'f1_macro',
    metricLabel: 'F1 (macro)',
    metricsPath: (fw) => path.join(CERTAMEN_DIR, 'output', fw, 'optuna_condition', 'latest', 'final_metrics.json'),
    exportScriptId: (fw) => (fw === 'pytorch' ? 'pt-export-onnx-condition' : 'tf-export-onnx-condition'),
  },
];
