# MTG Card Scanner — Certamen 2 (plan)

> 🚧 Planeación — todavía no implementado. Este documento es la base para arrancar
> la entrega 2: qué problema resolvemos, qué modelos nuevos hacen falta y qué
> datos necesitan.

## Consigna

> "Para la siguiente entrega deben agregar dos modelos que funcionen en un flujo
> de trabajo para resolver un problema." — feedback del profesor sobre Certamen 1.

> "El script subido tiene un ejemplo de utilización de optuna para la gestión de
> los hiperparámetros de entrenamiento. Para la próxima semana debe estar
> aplicado para su proyecto y determinado cuál es la mejor combinación de
> parámetros." — Alex, sobre `optuna_ejemplo.py`.

Dos entregas distintas, con plazos distintos: Optuna tiene deadline de **una
semana** y aplica a un modelo que ya existe hoy; el flujo de dos modelos nuevos
es el resto de Certamen 2 y tiene más margen. Van por separado más abajo.

## 0. Entrega inmediata — Optuna (esta semana)

El ejemplo (`optuna_ejemplo.py`) optimiza un MLP de Keras sobre Iris: define un
`objective(trial)` que arma el modelo con hiperparámetros propuestos por
Optuna, lo entrena, y retorna la métrica a maximizar; un `study` con sampler
TPE corre `N_TRIALS` de esa función y se queda con la mejor combinación.

**No hace falta esperar a los modelos nuevos de Certamen 2 para aplicar esto**
— ya tenemos un modelo entrenándose hoy con hiperparámetros fijos a mano:
`07_binary_classifier.py` (el detector MTG/no-MTG, en ambos frameworks). Para
la entrega inmediata se implementó Optuna sobre la versión **TensorFlow**, que
es el candidato natural para esta semana:

- Ya existe y entrena rápido (no hay que levantar nada nuevo).
- La versión TensorFlow ya usa Keras — mismo framework que el ejemplo, se
  adapta casi directo.
- Su constructor estaba configurado con `Adam(3e-4)`, `BATCH_SIZE = 32`,
  `freeze_ratio = 0.65` y cabeza `Dropout(0.3) → Dense(256) → ReLU →
  Dropout(0.2) → Dense(1)`. Ahora esos valores se pueden proponer desde Optuna
  sin cambiar el comportamiento predeterminado de `07_binary_classifier.py`.

Espacio de búsqueda propuesto (mapeado 1:1 a esas constantes):

| Hiperparámetro | Baseline | Rango implementado con Optuna |
|---|---|---|
| Learning rate | `3e-4` | `suggest_float("learning_rate", 1e-5, 1e-2, log=True)` |
| Weight decay | `0.0` | `suggest_float("weight_decay", 1e-6, 1e-2, log=True)` |
| Batch size | `32` | `suggest_categorical("batch_size", [16, 32, 64])` |
| Unidades cabeza densa | `256` | `suggest_int("head_units", 64, 512, step=64)` |
| Dropout (x2) | `0.3` / `0.2` | `suggest_float("dropout", 0.0, 0.5, step=0.05)` aplicado a ambos |
| Optimizer | `Adam` | `suggest_categorical("optimizer", ["adam", "adamw", "sgd"])` |
| Fracción de backbone congelada | `0.65` | `suggest_categorical("freeze_ratio", [0.50, 0.65, 0.80, 1.00])` |

Métrica a maximizar: `val_accuracy` (o `val_f1` si la clase MTG/no-MTG queda
desbalanceada) — igual que el ejemplo usa `val_accuracy` de Iris.

**Estado y pasos concretos:**

- [x] Agregar `optuna` a `requirements.txt` de `tensorFlow/` (y de `pytorch/` si
      se hace también ahí).
- [x] Script nuevo `tensorFlow/08_optuna_binary_classifier.py`: envolver el
      entrenamiento de `07_binary_classifier.py` en un `objective(trial)` con
      la tabla de arriba, correr un `study` (10–30 trials según tiempo
      disponible) y guardar `optuna_historia.png` + `optuna_importancia.png` en
      `output/tensorflow/optuna/{timestamp}/` — mismo patrón de `output/` ya
      usado por `04_evaluate.py` (historial versionado, no sobreescribe).
- [ ] Reentrenar el modelo final con los mejores hiperparámetros encontrados y
      reemplazar `tensorFlow/models/mtg_detector.keras`.
- [ ] Si alcanza el tiempo: repetir lo mismo para `pytorch/07_binary_classifier.py`
      (mismo patrón, Optuna es agnóstico al framework — solo cambia cómo se
      arma y entrena el modelo dentro de `objective`).
- [ ] Guardar `best_params.json` junto a los gráficos, para que quede registrado
      qué combinación ganó y con qué métrica.

Los dos últimos ítems se marcan solo después de ejecutar el experimento real;
tener el código implementado no equivale a haber medido una combinación
ganadora.

### Ejecutar la entrega Optuna

Desde `Proyecto/certamen_1`, reconstruir el dataset compartido con los scripts
ya usados en Certamen 1:

```powershell
py -3.12 -m venv tensorFlow\.venv
tensorFlow\.venv\Scripts\python.exe -m pip install --upgrade pip
tensorFlow\.venv\Scripts\python.exe -m pip install -r tensorFlow\requirements.txt

tensorFlow\.venv\Scripts\python.exe 01_scraper.py --max-cards 5000 --quality small
tensorFlow\.venv\Scripts\python.exe 02_downloader.py
```

Smoke test corto, desde `Proyecto/certamen_1/tensorFlow`:

```powershell
.venv\Scripts\python.exe 08_optuna_binary_classifier.py `
  --n 500 --trials 2 --trial-epochs 1 --no-final-train
```

Corrida nocturna que determina los mejores parámetros y reentrena el modelo:

```powershell
.venv\Scripts\python.exe 08_optuna_binary_classifier.py `
  --n 3000 --trials 20 --trial-epochs 6 --final-epochs 15
```

`--trials` representa el total objetivo del estudio. Si se interrumpe, reanudar
el mismo SQLite sin repetir trials terminados:

```powershell
.venv\Scripts\python.exe 08_optuna_binary_classifier.py `
  --resume-dir ..\output\tensorflow\optuna\2026-07-21_220000 `
  --trials 20
```

Cada corrida guarda `study.db`, `run_config.json`, `trials.csv`,
`best_params.json`, `optuna_historia.png` y `optuna_importancia.png` en
`output/tensorflow/optuna/{timestamp}/`. Si se permite el reentrenamiento final,
también guarda `final_metrics.json`, `final_training_history.json` y reemplaza
`tensorFlow/models/mtg_detector.keras` solo después de validar el checkpoint.

## 1. Flujo de dos modelos (el resto de Certamen 2)

Certamen 1 ya identifica una carta a partir de una foto (detector MTG/no-MTG +
retrieval por similitud visual). Certamen 2 extiende ese resultado con **dos
modelos nuevos, encadenados**, para resolver un problema de punta a punta:

> Dada una foto de una carta, identificarla con confianza y estimar su precio
> de mercado.

### Flujo de modelos propuesto

```
foto ─▶ [Certamen 1: detector MTG/no-MTG + retrieval visual] ─▶ carta candidata + similitud
                                                                        │
                                                                        ▼
                                        [Modelo nuevo 1: validador de texto/OCR]
                                        lee el nombre/texto de reglas de la carta y
                                        confirma o descarta la carta candidata
                                                                        │
                                                                        ▼
                                        [Modelo nuevo 2: estimador de precio (regresión)]
                                        predice el precio de mercado a partir de la
                                        metadata de la carta ya confirmada
                                                                        │
                                                                        ▼
                                        carta identificada + precio estimado (USD)
```

### Modelo nuevo 1 — Validador de texto (clasificación)

Motivación: la similitud visual sola puede confundir cartas con la misma
ilustración pero distinta edición/versión (reprints), o fallar con fotos de
mala calidad. El texto impreso en la carta (nombre, tipo, texto de reglas) es
una señal independiente de la visual.

Pipeline:
1. OCR sobre la región de texto de la carta (`pytesseract` / `easyocr` —
   herramienta, no modelo propio).
2. Modelo propio: clasificador de palabras entrenado por nosotros —
   arquitectura Bag-of-Words → Red Feedforward, basada en
   [`Material/detector_palabras.py`](../../Material/detector_palabras.py) —
   que compara el texto leído contra el de la carta candidata y da un score de
   confirmación (¿es texto consistente con esa carta o no?).

Dataset: `oracle_text` y `name` ya están en `data/cards.json` (vía Scryfall) —
no hace falta scrapear nada nuevo para el texto de referencia. Los negativos
pueden salir de texto de otras cartas o de las imágenes Pokémon ya descargadas
(`data/images_negatives/`).

Hiperparámetros a tunear con Optuna una vez exista el baseline (mismo patrón
de la sección 0): número de capas, unidades por capa, dropout, optimizer, lr,
batch size — literalmente el mismo espacio de búsqueda que
`Material/detector_palabras.py` / `optuna_ejemplo.py`, porque la arquitectura
es la misma (Bag-of-Words → Feedforward).

### Modelo nuevo 2 — Estimador de precio (regresión)

Motivación: da valor comercial concreto a la identificación (ver plan del
examen) — no solo "qué carta es", sino "cuánto vale hoy".

Entrada: metadata de la carta ya confirmada (rareza, set, `cmc`, colores,
`type_line`, antigüedad/`released_at`, `set_type`).
Salida: precio estimado en USD (regresión).

Dataset: Scryfall expone un campo `prices` (`usd`, `usd_foil`, `eur`, `tix`) en
el mismo bulk data que ya usa `01_scraper.py` — solo falta agregarlo a la lista
`CAMPOS`. No hace falta series históricas de precio, un snapshot actual alcanza
para un regresor de referencia (random forest / gradient boosting a modo de
baseline, con la opción de un MLP simple después).

Hiperparámetros a tunear con Optuna una vez exista el baseline: si es
random forest/gradient boosting → `n_estimators`, `max_depth`, `learning_rate`,
`subsample`; si es un MLP → mismo espacio que el validador de texto, cambiando
la métrica a minimizar (MAE o RMSE, `direction="minimize"`) en vez de maximizar
accuracy.

## 2. Qué falta para arrancar

- [ ] Agregar `prices` a `CAMPOS` en `01_scraper.py` y re-scrapear (o hacer un
      pase incremental sobre `data/cards.json` existente).
- [ ] Script de entrenamiento del validador de texto (nombre tentativo:
      `08_text_validator.py`).
- [ ] Script de entrenamiento del estimador de precio (nombre tentativo:
      `09_price_estimator.py`).
- [ ] Aplicar Optuna a ambos modelos nuevos una vez tengan un baseline
      entrenando (mismo patrón que la sección 0).
- [ ] Extender `scanner.py` (o `Testing/compare_scanners.py`) para exponer el
      flujo completo: foto → carta + confianza → validación de texto → precio.
- [ ] Métricas a reportar: accuracy del validador de texto; MAE / RMSE / R² del
      estimador de precio sobre un hold-out.

## 3. Por qué este enfoque

Se descartaron dos alternativas más simples (ver discusión en el chat del
proyecto):
- **Detector de daño/condición de la carta** — encaja con un ángulo comercial
  de tasación, pero requiere un dataset etiquetado a mano desde cero (mint /
  played / damaged) que no tenemos.
- **Solo estimador de precio** (sin el validador de texto) — es un flujo de un
  solo modelo nuevo, no dos, y no ataca el problema real de identificación
  ambigua que puede tener el sistema de Certamen 1.

Combinar validador de texto + estimador de precio da dos modelos genuinamente
encadenados (la salida de uno es prerequisito del otro) resolviendo un problema
concreto, y deja el terreno preparado para el ángulo comercial del examen.
