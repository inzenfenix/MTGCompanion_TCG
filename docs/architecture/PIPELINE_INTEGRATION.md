# Integración con la app Electron de automatización

> Actualizado 2026-09-11. La app Electron para la que se escribió
> originalmente este documento **ya existe y está en uso**:
> `apps/desktop-runner/`. Este documento sigue siendo el
> contrato de referencia para quien la modifique o extienda — qué invoca,
> con qué argumentos, cómo sabe si funcionó, dónde lee resultados — pero ya
> no es documentación de "lo que hay que construir", sino de "cómo está
> construido". Para el mapa de más alto nivel de `desktop-runner/` (UI,
> streaming de logs, `RUN_ALL_*`) ver
> [`docs/context/apps/desktop-runner.md`](../context/apps/desktop-runner.md)
> y [`docs/context/tools/README.md`](../context/tools/README.md).
> Si algo de este documento y el código de `scripts.config.ts` alguna vez
> no coinciden, **el código gana** — avisar y corregir acá.

> Este documento es el contrato entre "lo que ya existe en Python" y "lo que
> la app Electron orquesta" — qué invocar, con qué argumentos, cómo saber si
> funcionó, y dónde leer los resultados. No es documentación de usuario final
> (para eso están los README de cada carpeta) sino específicamente la interfaz
> que un proceso automatizado (no una persona en una terminal) necesita.

## 1. Modelo mental: nada corre "globalmente"

Cada framework (`pytorch/`, `tensorFlow/`) vive en su **propio venv**, nunca
mezclados. `ml/data-prep/` (dataset prep + baselines tabulares/OCR)
tiene el suyo también. Los scripts compartidos de la raíz de `ml/training/`
(`01_scraper.py`, `02_downloader.py`, `03_real_photos_downloader.py`) no
tienen venv propio — corren con el **venv de `pytorch/`** (ya trae
`requests`; ver `scripts.config.ts`, `env: 'pytorch'` en cada uno).

La Electron app **nunca** invoca un `python`/`pip` genérico del PATH.
Siempre el binario específico del venv:

```text
<carpeta>/.venv/bin/python           # Linux/macOS
<carpeta>/.venv/Scripts/python.exe   # Windows
```

Si un venv no existe, hay que crearlo e instalar su `requirements.txt` antes
de correr nada ahí — **no asumir que ya existe**. El patrón de referencia
(crear venv si falta, instalar requirements de forma idempotente, y si falla
por incompatibilidad de Python con TensorFlow reintentar con un Python
3.9–3.12 encontrado vía `pyenv`) está en `ml/training/04_evaluate.py`,
función `asegurar_venv()`. `desktop-runner` reusa esa lógica invocando los
scripts existentes en vez de reimplementar creación de venv del lado de
Electron.

## 2. Contrato que cumplen todos los scripts de este repo

- **CLI vía `argparse`**, nunca prompts interactivos (`input()`). Todo
  parámetro se pasa por flag, con default sensato si se omite.
- **Exit code 0 = éxito, no-cero = falló.** Ningún script termina con
  código 0 habiendo fallado silenciosamente (fue un bug real que se corrigió
  en `pytorch/04_evaluate.py` y `tensorFlow/04_evaluate.py` — ver historial).
- **Progreso por stdout**, línea por línea, pensado para logging/parsing
  simple (no hay barras de progreso ANSI que compliquen el parseo, salvo
  `tqdm` en descargas — ver sección 4 sobre eso).
- **Resultados versionados en `output/{framework|baseline}/{timestamp}/`**,
  con un symlink `latest/` apuntando a la corrida más reciente (o una copia
  en sistemas sin symlinks, p. ej. Windows sin privilegios de administrador).
  Esta carpeta **se versiona en git** (a propósito, es el historial de
  métricas) — a diferencia de `data/`, `.venv/` y `models/`, que son locales
  y están en `.gitignore`.
- **Modelos y binarios pesados nunca van a `output/`** — van a una carpeta
  `models/` local, gitignored (`pytorch/models/`, `tensorFlow/models/`,
  `ml/data-prep/models/`). `output/` solo tiene JSON + PNG livianos.
- **Export a ONNX sigue el mismo contrato** más una convención propia:
  cada `*_export_onnx*.py` define `IONIC_MODELS_DIR` y un helper
  `publicar_en_ionic()` que copia el archivo exportado a
  `apps/mobile/public/models/stage{N}-{nombre}.onnx`, no-op con
  warning si el proyecto Ionic no está presente, saltable con
  `--no-ionic-copy`.

## 3. Inventario de scripts

El inventario completo y actualizado vive como código en
`desktop-runner/apps/server/src/scripts/scripts.config.ts` (`SCRIPTS`,
`RUN_ALL_*`) — es el manifiesto declarativo que la sección 5 de una versión
anterior de este documento pedía que se creara. Lo de abajo es un resumen
por carpeta, no un espejo campo por campo de ese archivo.

### Dataset compartido (`ml/training/`, venv de `pytorch/`)

| Script | Qué hace | Args clave | Salida |
|---|---|---|---|
| `01_scraper.py` | Descarga catálogo Scryfall, filtra y arma `data/cards.json` — **destructivo**, sobreescribe el archivo entero truncado a `--max-cards`; excluido de todo "Correr TODO" automático | `--max-cards N` (0=sin cap), `--quality {small,normal,large,png}` | `data/cards.json`, `data/raw_cards.json` (cache) |
| `02_downloader.py` | Descarga imágenes del catálogo — idempotente | `--workers N`, `--delay S` | `data/images/{id}.jpg` (resumible) |
| `03_real_photos_downloader.py` | Descarga fotos reales (no renders) para datasets de condición/generalización — idempotente | — | `data/real_photos/` |
| `04_evaluate.py` | Orquesta evaluación de retrieval de uno o ambos frameworks; **crea los venvs de pytorch/tensorFlow si faltan** | `--model {pytorch,tensorflow,both}` (default: both) | `output/{framework}/{timestamp}/` |

### PyTorch (`ml/training/pytorch/`, venv propio) — Stage 1 + 2 + 3 + 4

| Script | Etapa | Qué hace | Salida |
|---|---|---|---|
| `03_pt_embedder.py` | — | Índice de embeddings (EfficientNet_b0) | `data/embeddings_pt.npy`, `data/index_pt.json` |
| `07_binary_classifier.py`, `08_optuna_binary_classifier.py` | Stage 1 | Detector MTG/no-MTG (fijo / Optuna) | `models/mtg_detector.pth` + métricas |
| `09_export_onnx.py` | Stage 1 | Exporta detector + embedder a ONNX | `models/mtg_detector.onnx`, publica `stage1-detector.onnx` |
| `10_condition_grader.py`, `11_optuna_condition_grader.py` | Stage 4 (plano) | Calificador de condición, dataset curado — **no es el checkpoint que se publica**, ver `docs/context/models/README.md` | `models/condition_grader.pth` |
| `12_condition_grader_combined.py` | Stage 4 (real+sintético) | Reentrena sobre real+sintético — **este es el checkpoint que se exporta** | `models/condition_grader_combined.pth` |
| `12_export_onnx_condition.py` | Stage 4 | Exporta el checkpoint combinado a ONNX | publica `stage4-condition-grader.onnx` |
| `14_text_validator.py`, `15_optuna_text_validator.py` | Stage 2 | Validador de texto (MLP sobre `HashingVectorizer`) | `models/text_matcher.pth` |
| `16_export_onnx_text_validator.py` | Stage 2 | Exporta a ONNX | publica `stage2-text-validator.onnx` |
| `15_price_estimator.py`, `17_optuna_price_estimator.py` | Stage 3 | Estimador de precio (tabular + embedding visual congelado) | `models/price_regressor.pth` |
| `18_export_onnx_price_estimator.py` | Stage 3 | Exporta a ONNX | publica `stage3-price-estimator.onnx` |
| `19_export_onnx_price_embedding.py` | Stage 3 | Exporta el backbone de Stage 1 como embedding puro (1280-dim) — **sin equivalente en TensorFlow**, ver `docs/context/models/README.md` | publica `stage1-embedder.onnx` |
| `prepare_price_embeddings.py` | Stage 3 | Precalcula embeddings visuales para el dataset de precio | — |
| `scanner.py` | — | Demo CLI: identifica una carta desde una foto | stdout (parseable, `Testing/compare_scanners.py`) |
| `predict_condition.py`, `predict_price.py`, `predict_text_validator.py` | 2/3/4 | CLIs de inferencia puntual por etapa, para debugging/demo | stdout |

### TensorFlow (`ml/training/tensorFlow/`, venv propio) — mismas 4 etapas, numeración propia

Mismo inventario funcional que PyTorch: `03_build_embeddings.py` en vez de
`03_pt_embedder.py`; `07_binary_classifier.py`/`08_optuna_binary_classifier.py`
(Stage 1); `09_condition_grader.py`/`10_optuna_condition_grader.py` (Stage 4
plano) + `11_condition_grader_combined.py` (Stage 4 combinado, el que se
exporta); `12_text_validator.py`/`13_optuna_text_validator.py` (Stage 2);
`13_price_estimator.py`/`15_optuna_price_estimator.py` (Stage 3); export a
ONNX vía `09_export_onnx.py`, `11_export_onnx_condition.py`,
`14_export_onnx_text_validator.py`, `16_export_onnx_price_estimator.py`
(sin equivalente de `19_export_onnx_price_embedding.py` — ver arriba).
`08_optuna_binary_classifier.py` acá además necesita
`optuna-integration[tfkeras]` para el pruning callback (ver su
`requirements.txt`) — la versión PyTorch no lo necesita, usa
`trial.report()`/`trial.should_prune()` manual.

### Certamen 2 (`ml/data-prep/`, venv propio) — dataset prep + baselines, no el entrenamiento "de verdad"

| Script | Qué hace | Salida |
|---|---|---|
| `prepare_text_validator_dataset.py` | OCR (tesseract) + armado del dataset real de pares texto, alimenta `pytorch/14_text_validator.py`/`tensorFlow/12_text_validator.py` | `data/text_pairs/` |
| `prepare_price_dataset.py` | Arma el dataset tabular+visual de precio | `data/price_dataset/` |
| `prepare_condition_dataset.py` | Arma el dataset de condición (real + augmentación sintética vía `synthetic_wear.py`/`synthetic_sleeve.py`) | `data/condition_dataset/` |
| `download_roboflow_condition_data.py`, `import_roboflow_condition_data.py` | Descarga/importa las fotos reales anotadas de Roboflow para condición | `data/roboflow_condition/` |
| `price_estimator_baseline.py` | Baseline tabular de precio (RF/GB, sin imágenes) — sklearn, framework-agnóstico | `output/price_baseline/{timestamp}/` + `models/price_baseline_model.joblib` |
| `text_validator_baseline.py` | Baseline OCR de validación de texto (OpenCV + tesseract) | `output/text_validator_baseline/{timestamp}/` |
| `card_preprocessing.py`, `orientation_fix.py` | Helpers compartidos de OpenCV (crop/perspectiva/normalización, corrección de orientación) | — |
| `full_pipeline_demo.py` | Demo end-to-end de las 4 etapas sobre una foto | stdout |

Los dos baselines (`price_estimator_baseline.py`, `text_validator_baseline.py`)
siguen siendo **precursores/referencia** — el modelo real que se entrena,
compara entre frameworks y exporta vive en `ml/training/pytorch/` y
`ml/training/tensorFlow/` (tablas de arriba), no acá.

## 4. Detalles que importan para una UI

- **Descargas largas** (`02_downloader.py`, y las que hace
  `07_binary_classifier.py`/`08_optuna_...py` para los negativos de Pokémon)
  usan `tqdm` cuando está disponible — en un proceso hijo sin TTY, `tqdm`
  cae automáticamente a líneas de texto planas (`N/total`), no barras ANSI.
  No hace falta un parser especial, pero tampoco hay porcentaje limpio en
  cada línea — calcular progreso contando líneas si se necesita una barra.
- **Runs largas de Optuna son interrumpibles**: `Ctrl+C`
  (`SIGINT`/`SIGTERM` desde Electron) deja `study.db` consistente con los
  trials ya terminados y el script imprime el comando exacto para reanudar
  con `--resume-dir`. `desktop-runner`'s `stopRun()` hace exactamente esto
  (POSIX process-group kill) — matar el proceso así es seguro, no corrompe
  el estudio.
- **`--resume-dir` es la base de la UX de pausa/reanudación** de
  `desktop-runner` — apuntando al mismo directorio de una corrida anterior,
  el estudio retoma sin repetir trials completos.
- **GPU vs CPU**: los scripts de PyTorch imprimen el `Device` detectado
  (`cuda`/`cpu`) al arrancar; los de TensorFlow, no explícitamente.
  `desktop-runner` ya auto-detecta ROCm/AMD y aplica
  `HSA_OVERRIDE_GFX_VERSION` para PyTorch, y cae TensorFlow a CPU en AMD
  automáticamente (ver `docs/context/environment/README.md`).
- **Tiempos**: un trial de Optuna a escala completa tarda minutos en GPU y
  bastante más en CPU — `desktop-runner` trata cada corrida como un job en
  background con logs en vivo (`LogsGateway`, socket.io), no como una acción
  bloqueante.

## 5. Estado de lo que este documento pedía originalmente

Todo lo que esta sección listaba como pendiente cuando se escribió el
documento ya está resuelto:

- ✅ `01_scraper.py`/`02_downloader.py`/`03_real_photos_downloader.py` usan
  el venv de `pytorch/` (`env: 'pytorch'` en `scripts.config.ts`) — no
  tienen uno propio, y no lo necesitan.
- ✅ El manifiesto declarativo que se pedía existe — vive en
  `scripts.config.ts` (`SCRIPTS`, `RUN_ALL_*`) dentro de `desktop-runner`
  mismo, tal como este documento sugería que pasaría ("no hace falta que
  viva en este repo"... y de hecho vive en este repo, pero como código
  TypeScript en vez de JSON/YAML — cumple la misma función). Esa es la
  fuente de verdad si este inventario alguna vez queda desactualizado, no
  al revés.
- ✅ Stage 2/3 "de verdad" (con embeddings visuales, entrenados por
  framework) existen — ver tablas de la sección 3.
- ✅ Exportación a ONNX existe para las 4 etapas, con la convención
  `publicar_en_ionic()` descrita en la sección 2.

No queda ningún pendiente estructural de este documento — cualquier gap
real hoy (features nuevas, no infraestructura de automatización) vive en
`ROADMAP.md`.
