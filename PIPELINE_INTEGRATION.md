# Integración con la app Electron de automatización

> Para quien construya la app Electron que envuelve estos scripts (ver
> [Proyecto/certamen_2/README.md, sección 4](Proyecto/certamen_2/README.md)).
> Este documento es el contrato entre "lo que ya existe en Python" y "lo que
> la app tiene que orquestar" — qué invocar, con qué argumentos, cómo saber si
> funcionó, y dónde leer los resultados. No es documentación de usuario final
> (para eso están los README de cada carpeta) sino específicamente la interfaz
> que un proceso automatizado (no una persona en una terminal) necesita.

## 1. Modelo mental: nada corre "globalmente"

Cada framework (`pytorch/`, `tensorFlow/`) vive en su **propio venv**, nunca
mezclados. `Proyecto/certamen_2/` (los baselines tabulares/OCR) tiene el suyo
también. Los scripts compartidos de la raíz de `certamen_1/`
(`01_scraper.py`, `02_downloader.py`) son la única excepción: no tienen venv
propio, solo necesitan `requests` — ver sección 5 para cómo resolver esto.

La Electron app **nunca** debe invocar un `python`/`pip` genérico del PATH.
Siempre el binario específico del venv:

```text
<carpeta>/.venv/bin/python           # Linux/macOS
<carpeta>/.venv/Scripts/python.exe   # Windows
```

Si un venv no existe, hay que crearlo e instalar su `requirements.txt` antes
de correr nada ahí — **no asumir que ya existe**. El patrón de referencia ya
implementado (crear venv si falta, instalar requirements de forma idempotente,
y si falla por incompatibilidad de Python con TensorFlow reintentar con un
Python 3.9–3.12 encontrado vía `pyenv`) está en
`Proyecto/certamen_1/04_evaluate.py`, función `asegurar_venv()`. La forma más
simple de reusar esa lógica sin reimplementarla en JS/TS es que la app
invoque literalmente ese script (o sus equivalentes por carpeta) en vez de
reconstruir la lógica de creación de venv del lado de Electron.

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
  `certamen_2/models/`). `output/` solo tiene JSON + PNG livianos.

## 3. Inventario de scripts

### Dataset compartido (`Proyecto/certamen_1/`, sin venv propio)

| Script | Qué hace | Args clave | Salida |
|---|---|---|---|
| `01_scraper.py` | Descarga catálogo Scryfall, filtra y arma `data/cards.json` | `--max-cards N` (0=sin cap), `--quality {small,normal,large,png}` | `data/cards.json`, `data/raw_cards.json` (cache) |
| `02_downloader.py` | Descarga imágenes del catálogo | `--workers N`, `--delay S` | `data/images/{id}.jpg` (idempotente, resumible) |
| `04_evaluate.py` | Orquesta evaluación de retrieval de uno o ambos frameworks; **crea los venvs de pytorch/tensorFlow si faltan** | `--model {pytorch,tensorflow,both}` (default: both) | `output/{framework}/{timestamp}/` |

### PyTorch (`Proyecto/certamen_1/pytorch/`, venv propio)

| Script | Qué hace | Args clave | Salida |
|---|---|---|---|
| `03_pt_embedder.py` | Construye el índice de embeddings (EfficientNet_b0) | — | `data/embeddings_pt.npy`, `data/index_pt.json` |
| `07_binary_classifier.py` | Entrena el detector MTG/no-MTG (hiperparámetros fijos) | `--skip-download`, `--n`, `--epochs` | `models/mtg_detector.pth`, `models/mtg_detector_cfg.json`, `results/metrics_binary.json` + PNGs |
| `08_optuna_binary_classifier.py` | Busca hiperparámetros del detector con Optuna y reentrena con los mejores | `--n`, `--trials`, `--trial-epochs`, `--final-epochs`, `--resume-dir`, `--no-final-train`, `--skip-download` | `../output/pytorch/optuna/{timestamp}/` (`study.db`, `best_params.json`, `trials.csv`, `optuna_historia.png`, `optuna_importancia.png`, `final_metrics.json`) + publica `models/mtg_detector.pth` |
| `04_evaluate.py` | Evalúa retrieval (implementación; normalmente se invoca vía el orquestador de la raíz) | `--output-dir` | `metrics_pt.json` + PNGs en el dir indicado |
| `scanner.py` | Demo CLI: identifica una carta desde una foto | `imagen`, `--top`, `--threshold`, `--skip-detect` | stdout (parseable, ver `Testing/compare_scanners.py`) |

### TensorFlow (`Proyecto/certamen_1/tensorFlow/`, venv propio)

Mismo inventario que PyTorch, con `03_build_embeddings.py` en vez de
`03_pt_embedder.py`, y `08_optuna_binary_classifier.py` publicando
`models/mtg_detector.keras` en `../output/tensorflow/optuna/{timestamp}/`.
`08_optuna_binary_classifier.py` acá además necesita `optuna-integration[tfkeras]`
para el pruning callback (ver su `requirements.txt`) — la versión PyTorch no
lo necesita, usa `trial.report()`/`trial.should_prune()` manual.

### Certamen 2 (`Proyecto/certamen_2/`, venv propio)

| Script | Qué hace | Args clave | Salida |
|---|---|---|---|
| `price_estimator_baseline.py` | Baseline tabular de precio (RF/GB sobre metadata, sin imágenes) | `--model {rf,gb}`, `--n`, `--output-dir` | `output/price_baseline/{timestamp}/` + `models/price_baseline_model.joblib` (gitignored, ~800 MB) |
| `text_validator_baseline.py` | Baseline OCR de validación de texto (OpenCV + tesseract) | `--n`, `--quality {normal,large,png}`, `--output-dir` | `output/text_validator_baseline/{timestamp}/` + `data/ocr_images/` (cache de descargas propio, gitignored) |

Estos dos son **precursores** de los modelos "de verdad" de Stage 2/3 (ver
`Proyecto/certamen_2/README.md`, secciones 0 y 1) — todavía no existen
`08_text_validator.py`/`09_price_estimator.py` por framework. Cuando existan,
seguirán el mismo contrato (CLI, exit codes, `output/` versionado) descrito
acá, así que la app no debería necesitar cambios estructurales para sumarlos,
solo agregar filas a su inventario interno de pasos.

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
  con `--resume-dir`. Si la app expone un botón "detener", matar el proceso
  así es seguro — no corrompe el estudio.
- **`--resume-dir` es la base de una UX de pausa/reanudación**: apuntando al
  mismo directorio de una corrida anterior, el estudio retoma sin repetir
  trials completos. Útil para que la app permita "seguir entrenando" en vez
  de perder progreso si se cierra a mitad de una corrida.
- **GPU vs CPU**: los scripts de PyTorch imprimen el `Device` detectado
  (`cuda`/`cpu`) al arrancar; los de TensorFlow, no explícitamente — si la
  UI quiere mostrarlo, conviene agregarlo (ver `08_optuna_binary_classifier.py`
  de TensorFlow como referencia de dónde imprimir).
- **Tiempos**: un trial de Optuna a escala completa (`--n 3000`,
  `--trial-epochs 6`) tarda minutos en GPU y bastante más en CPU — una
  corrida de 20 trials + reentrenamiento final es una tarea de fondo (horas,
  no segundos). La UI debería tratar esto como un job en background con
  logs en vivo, no como una acción bloqueante.

## 5. Qué falta para que la automatización sea prolija

- [ ] `01_scraper.py`/`02_downloader.py` no tienen venv propio (solo
      `requests`) — decidir si usan uno de los venvs de framework (ambos ya
      tienen `requests` en su `requirements.txt`) o si les conviene un venv
      compartido propio en la raíz de `certamen_1/`.
- [ ] No existe todavía un manifiesto declarativo (JSON/YAML) que liste cada
      paso del pipeline con su venv/args/salida esperada — hoy esa
      información vive en este documento y hay que mantenerla sincronizada a
      mano si se agregan scripts. Si la app crece, vale la pena que la propia
      Electron app defina ese manifiesto (no hace falta que viva en este
      repo) y lo use para generar su UI en vez de hardcodear cada paso.
- [ ] Stage 2/3 "de verdad" (con embeddings visuales, no los baselines)
      todavía no existen — ver checklist de
      [certamen_2/README.md](Proyecto/certamen_2/README.md#6-qué-falta-para-arrancar-roadmap).
- [ ] Exportación a ONNX (sección 3 del README de certamen_2) tampoco existe
      todavía — cuando exista, probablemente sea otro script por framework
      con el mismo contrato.
