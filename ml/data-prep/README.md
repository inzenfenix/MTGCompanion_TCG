# MTG Card Scanner — Certamen 2

> 🚧 En construcción. Hecho hasta ahora: Optuna + migración a MobileNetV3Small
> sobre el detector MTG/no-MTG (sección 0 y sección 1), el dataset compartido
> re-scrapeado con estilo/texto/precio (sección 5), los baselines de Stage 2
> y 3 (secciones 5.1/5.2), y Stage 4 completo — clasificador de condición,
> ambos frameworks, Optuna, dataset combinado con fotos reales, comparación
> de generalización (sección 9). Falta: las versiones "de verdad" (no
> baseline) de Stage 2/3, y exportar TensorFlow a ONNX. El resto de este
> documento es el plan acordado para el flujo de tres modelos que alimenta la
> app Ionic — ver [apps/README.md](../../apps/README.md).

## Consigna

> "Para la siguiente entrega deben agregar dos modelos que funcionen en un flujo
> de trabajo para resolver un problema." — feedback del profesor sobre Certamen 1.

> "El script subido tiene un ejemplo de utilización de optuna para la gestión de
> los hiperparámetros de entrenamiento. Para la próxima semana debe estar
> aplicado para su proyecto y determinado cuál es la mejor combinación de
> parámetros." — Alex, sobre `optuna_ejemplo.py`.

## 0. Optuna sobre el detector MTG/no-MTG — ✅ hecho

Entrega de la semana de Optuna, ya ejecutada de punta a punta:

- [x] `optuna` agregado a `tensorFlow/requirements.txt`.
- [x] `tensorFlow/08_optuna_binary_classifier.py`: envuelve el entrenamiento de
      `07_binary_classifier.py` en un `objective(trial)` (lr, weight decay,
      batch size, unidades/dropout de la cabeza, optimizer, fracción de
      backbone congelada) y corre un `study` con sampler TPE.
- [x] Corrida real completada — resultados en
      `ml/training/output/tensorflow/optuna/2026-07-21_104919/`
      (`best_params.json`, `optuna_historia.png`, `optuna_importancia.png`,
      `final_metrics.json`) y `tensorFlow/models/mtg_detector.keras` reentrenado
      con los mejores hiperparámetros. Instrucciones de reanudar/trasladar la
      corrida en `output/tensorflow/optuna/README.md`.
- [x] Repetido para PyTorch: `pytorch/08_optuna_binary_classifier.py`, mismo
      search space y mismo formato de artefactos que la versión TensorFlow.
      Requirió un refactor menor de `07_binary_classifier.py` (la arquitectura
      `MTGDetector` se movió a `pytorch/src/binary_classifier.py`, parametrizada
      por `head_units`/`freeze_ratio`/`dropout`, para que la corrida normal y
      Optuna entrenen exactamente el mismo modelo) y actualizar `scanner.py`
      para reconstruir la arquitectura desde `mtg_detector_cfg.json` en vez de
      asumir los defaults — necesario porque PyTorch guarda solo pesos
      (`state_dict`), a diferencia de `.keras` que empaqueta arquitectura +
      pesos. Corrida real completada (n=3000, 20 trials — 4 podados por el
      pruner, 15 épocas finales) — resultados en
      `ml/training/output/pytorch/optuna/latest/`. Ganador: trial 0
      (`optimizer=adam, lr=1.3e-4, weight_decay=6.4e-3, batch_size=16,
      head_units=128, dropout=0.0, freeze_ratio=0.65`), `val_accuracy=1.0000`
      en el split de validación (renders oficiales, ambas clases).

      **Ese 1.0 es real pero acotado al tipo de imagen con el que se mide**:
      el detector separa "render oficial de Magic" de "render oficial de
      Pokémon" — dos clases con bordes, tipografía e iconografía muy
      distintos, sobre un backbone ya preentrenado en ImageNet — no es un
      problema de clasificación fina. Confirmado con una foto de celular real
      (no un render limpio, no parte de ningún split): `P(MTG)=0.9084` sobre
      la misma carta que reveló el índice de embeddings desactualizado
      (sección 5.3) — sigue clasificando correcto, pero la confianza baja de
      100% a ~91% apenas sale de la distribución de entrenamiento/validación.
      Mismo patrón ya visto en esta entrega (embeddings, condición): las
      métricas sobre datos curados son un techo, no una garantía sobre fotos
      reales.

## 1. Arquitectura del pipeline completo

Conversación de equipo (7 ago): el resto de Certamen 2 no son "dos modelos
sueltos" sino **tres etapas encadenadas**, cada una replicada en ambos
frameworks — 3 × 2 = **6 modelos entrenados en total**. La razón de duplicar
cada etapa es la misma que en Certamen 1: comparar PyTorch vs. TensorFlow con
las mismas métricas, y quedarnos con el que mejor rinda en cada etapa
específica (no necesariamente el mismo framework gana las tres).

```
foto ─▶ OpenCV (recorte/perspectiva/normalización)
              │
              ▼
   ┌─────────────────────────────────────────────┐
   │ Stage 1 — Detector MTG / no-MTG              │  ya existe (Certamen 1)
   │   PyTorch: EfficientNet_b0                   │  Optuna: ✅ TF, ✅ PT
   │   TensorFlow: MobileNetV3                    │
   └─────────────────────────────────────────────┘
              │ (si es MTG)
              ▼
   ┌─────────────────────────────────────────────┐
   │ Stage 2 — Validador de texto (OCR)           │  nuevo — Certamen 2
   │   PyTorch: EfficientNet_b0 + cabeza propia    │
   │   TensorFlow: MobileNetV3 + cabeza propia     │
   └─────────────────────────────────────────────┘
              │ (texto confirma la carta candidata)
              ▼
   ┌─────────────────────────────────────────────┐
   │ Stage 3 — Estimador de precio (regresión)    │  nuevo — Certamen 2
   │   PyTorch: EfficientNet_b0 + cabeza propia    │
   │   TensorFlow: MobileNetV3 + cabeza propia     │
   └─────────────────────────────────────────────┘
              │
              ▼
   selector: por etapa, se queda con el framework de mejor métrica (sección 2)
              │
              ▼
   carta identificada + texto validado + precio estimado (USD)
```

### Backbones

- **PyTorch**: `EfficientNet_b0` — sin cambios, es el que ya usa Certamen 1.
- **TensorFlow**: se migra `MobileNetV2` → **`MobileNetV3Small`** para las
  tres etapas. Motivo: mejor trade-off precio/latencia que V2 y pensado desde
  el diseño para inferencia móvil — encaja directo con el objetivo final
  (correr en la app Ionic vía ONNX). **Stage 1 ya migrado (8 ago, ver
  abajo)** — Stage 4 ya nació directo en V3Small (sección 9); Stage 2/3
  todavía no tienen versión "de verdad" con backbone (siguen en baseline).
- Las tres etapas **comparten el mismo backbone por framework** (transfer
  learning, distintas cabezas/fine-tuning por tarea) — es la misma estrategia
  que ya usa `07_binary_classifier.py`, extendida a las otras dos tareas.

  > ⚠️ Supuesto a confirmar en equipo: para Stage 2 (texto) esto implica que el
  > "modelo propio" es un clasificador de imagen (verifica visualmente la
  > región de texto) en vez del enfoque original de bag-of-words +
  > feedforward sobre texto de OCR. Se mantiene OCR (`pytesseract`/`easyocr`)
  > para *extraer* el texto, pero la confirmación por backbone es la línea por
  > defecto de este documento porque unifica arquitectura, entrenamiento,
  > tuning con Optuna y exportación a ONNX en las tres etapas. Si el equipo
  > prefiere el bag-of-words original para Stage 2, es un cambio de una
  > sección, no del resto del plan.

### Stage 1 — Detector MTG/no-MTG (existente, migrado)

Ya construido y evaluado en Certamen 1. Pendiente para dejarlo alineado con
las otras dos etapas:

- [x] Migrar la versión TensorFlow de `MobileNetV2` a `MobileNetV3Small`
      (8 ago, JoacoRW) — `src/binary_classifier.py` y `src/embeddings.py`
      (retrieval). De paso corrigió un bug latente: `embeddings.py` seguía
      llamando `mobilenet_v2.preprocess_input` sobre embeddings de V3 —V3
      hace el rescaling adentro del modelo (capa `Rescaling`), así que ese
      preprocess_input residual habría corrompido en silencio el rango de
      píxeles de cada embedding. Resultado real, mismo split galería/consulta
      (5,000/1,000) antes y después:

      | Métrica | MobileNetV2 (antes) | MobileNetV3Small (después) |
      |---|---|---|
      | Top-1 retrieval accuracy | 26.4% | **40.9%** |
      | MRR | 0.317 | **0.477** |
      | F1 (clasificación) | 0.528 | **0.631** |
      | ROC-AUC | 0.735 | 0.714 |

      Para contexto, PyTorch (`EfficientNet_b0`, sin cambios) está en 41.2%
      top-1 / MRR 0.454 sobre el mismo split — TensorFlow pasó de ir
      claramente atrás (26% vs. 41%) a estar prácticamente empatado. V2 era
      un cuello de botella real en Stage 1, no solo una etapa pendiente de
      prolijidad.
- [x] Optuna sobre la versión PyTorch — ver sección 0.
- [x] Exportar PyTorch a ONNX: `pytorch/09_export_onnx.py`
      (`torch.onnx.export` + verificación de paridad numérica contra
      `onnxruntime`, diff máxima ~0 en la corrida de prueba). Falta el lado
      TensorFlow (`tf2onnx`, mismo patrón) — ya no bloqueado por la
      migración (que terminó), sigue pendiente nomás.

### Stage 2 — Validador de texto (OCR)

Motivación: la similitud visual sola puede confundir cartas con la misma
ilustración pero distinta edición/versión (reprints), o fallar con fotos de
mala calidad. El texto impreso en la carta (nombre, tipo, texto de reglas) es
una señal independiente de la visual.

Pipeline:
1. **OpenCV**: recorte y corrección de perspectiva de la región de texto de la
   carta (misma normalización que ya hace falta para Stage 1, reutilizada).
2. **OCR** (`pytesseract` / `easyocr` — herramienta, no modelo propio) extrae
   el texto de esa región.
3. **Modelo propio** (por framework, ver supuesto arriba): compara el texto
   leído contra `oracle_text` / `name` de la carta candidata (ya identificada
   por Stage 1 + retrieval de Certamen 1) y da un score de confirmación.

Dataset: `oracle_text` y `name` recién se agregaron a `CAMPOS` en
`01_scraper.py` (antes no estaban — esta era una suposición incorrecta de una
versión anterior de este plan). Falta re-scrapear o hacer un pase incremental
sobre `data/cards.json` para tenerlos. Los negativos pueden salir de texto de
otras cartas o de las imágenes Pokémon ya descargadas
(`data/images_negatives/`).

### Stage 3 — Estimador de precio (regresión)

Motivación: da valor comercial concreto a la identificación (ver
[plan del examen](../../apps/README.md)) — no solo "qué carta es", sino
"cuánto vale hoy".

Entrada: metadata de la carta ya confirmada (rareza, set, `cmc`, colores,
`type_line`, antigüedad/`released_at`, `set_type`) + el embedding visual del
backbone compartido como feature adicional.
Salida: precio estimado en USD (regresión).

Dataset: `prices` (`usd`, `usd_foil`, `eur`, `tix`) recién se agregó a
`CAMPOS` en `01_scraper.py` (mismo bulk data que ya usa `01_scraper.py`, solo
faltaba pedirlo). Un snapshot actual alcanza para un regresor de referencia —
no hace falta series históricas de precio. Diseño detallado del feature
vector combinado (tabular + embedding visual): sección 5.1.1.

## 2. Selección del mejor framework por etapa

El pipeline final no asume de antemano que un framework gana las tres etapas.
Por cada etapa se corre `04_evaluate.py`-style (mismo patrón de Certamen 1:
métricas versionadas en `output/`) para ambos frameworks y se compara:

- Stage 1 y 2 (clasificación): ROC-AUC como métrica principal.
- Stage 3 (regresión): RMSE / R² como métrica principal.

El ganador de cada etapa queda registrado (ej. `output/best_model.json`,
`{"stage1": "pytorch", "stage2": "tensorflow", "stage3": "pytorch"}`) y es lo
que el pipeline final consulta antes de correr cada etapa. Regla operativa
cuando una métrica sale baja: la primera palanca es **agregar más datos**
(ampliar `--n` / `--max-cards`) antes de cambiar de arquitectura o de
hiperparámetros — es más barato y suele explicar la mayoría de los casos de
ROC-AUC bajo en este proyecto (dataset desbalanceado o chico).

## 3. ONNX — portabilidad a la app Ionic

Reemplaza el enfoque anterior del [plan del examen](../../apps/README.md), que
proponía llevar solo TensorFlow (vía TensorFlow.js) a la app. Con ONNX como
formato de exportación común:

- PyTorch exporta con `torch.onnx.export` (ya es su ruta nativa).
- TensorFlow exporta con `tf2onnx` sobre el modelo Keras.
- La app Ionic corre inferencia con **`onnxruntime-web`**, sin importar qué
  framework ganó cada etapa (sección 2) — el selector de mejor framework deja
  de ser una decisión de "a qué framework le apostamos para siempre" y pasa a
  ser una decisión por etapa, resuelta en tiempo de build/deploy.

Esto también evita el salto extra que tenía la ruta PyTorch → ONNX →
onnxruntime-web mencionado en el plan anterior del examen: ahora **ambos**
frameworks pasan por ONNX, es la ruta principal para los dos, no un rodeo para
uno solo.

## 4. Automatización del entrenamiento (Electron, en paralelo)

Un integrante del equipo está construyendo una app Electron que envuelve los
scripts Python existentes (scraper, downloader, embedders, clasificadores,
Optuna) para automatizar la creación de los 6 modelos sin tocar la terminal.
Para que eso funcione sin fricción, los scripts nuevos de Stage 2 y Stage 3
deben mantener el mismo contrato que ya usan `01_scraper.py` / `02_downloader.py`
/ `04_evaluate.py`:

- CLI vía `argparse`, nunca interacción por input().
- Exit code `0` solo si terminó bien; `sys.exit(1)` en cualquier prerequisito
  faltante (mismo criterio que se aplicó en Certamen 1, ver
  [ml/training/README.md](../training/README.md)).
- Salidas a rutas predecibles y versionadas bajo `output/` (`--output-dir`),
  igual que `04_evaluate.py`.

## 5. Datos — estado (7 ago)

- [x] Agregar `oracle_text` y `prices` a `CAMPOS` en `01_scraper.py`.
- [x] Diversidad de estilo: `01_scraper.py` ahora conserva hasta 3 impresiones
      por nombre de carta (antes: 1, la más reciente), priorizando firmas de
      estilo distintas (`frame`/`border_color`/`frame_effects`). También se
      agregaron `frame`, `border_color`, `frame_effects`, `finishes` a `CAMPOS`
      — señal de estilo y de foil/precio. Se descartó eBay como fuente (riesgo
      de ToS/derechos de imagen en una app de uso comercial, precios de
      publicación en vez de venta real, labels ruidosos) — ver discusión en
      el chat del proyecto.
- [x] Bug encontrado y arreglado en el camino: Scryfall migró bulk-data de
      JSON plano (`download_uri`/`size`) a JSONL comprimido con gzip
      (`jsonl_download_uri`/`compressed_size`). `01_scraper.py` ya soporta el
      formato nuevo.
- [x] Re-scrapeado el dataset compartido con el `CAMPOS` actualizado:
      **58,174 impresiones** sobre **31,514 nombres únicos** (1.85
      impresiones/carta en promedio), **88.7 % con `prices.usd` utilizable**
      (51,623 cartas). `data/cards.json` pasó de 2.7 MB a 58.8 MB.
- [ ] Descarga de imágenes (`02_downloader.py`) en curso para las ~53k
      impresiones nuevas (5,000 ya estaban cacheadas de antes).
- [x] Baseline tabular de Stage 3 entrenado y evaluado — ver sección 5.1.
- [ ] Preparar el dataset de recorte de región de texto (Stage 2) con OpenCV
      — pendiente de que termine la descarga de imágenes.

Fuentes de datos — ya cubren "distintas bases de datos": **Scryfall**
(catálogo, `oracle_text`, `prices`, estilo) y **pokemontcg.io** (negativos
para el detector, ya integrado desde Certamen 1). No se identificó necesidad
de una tercera fuente todavía; si más adelante hace falta precio histórico
(no solo snapshot), ahí sí habría que sumar otra API.

### 5.1 Baseline de Stage 3 — `price_estimator_baseline.py`

Antes de construir las dos versiones "de verdad" de Stage 3 (PyTorch
EfficientNet_b0 + TensorFlow MobileNetV3, con el embedding visual como
feature adicional — sección 1), se armó un baseline **tabular, framework-
agnóstico** (`scikit-learn`) que solo usa metadata — no necesita que la
descarga de imágenes termine. Sirve como piso de referencia: si los modelos
con backbone no superan claramente este baseline, no vale la pena el costo
extra de entrenarlos con imágenes.

```bash
cd ml/data-prep
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

python price_estimator_baseline.py                  # RandomForest (default)
python price_estimator_baseline.py --model gb        # GradientBoosting
python price_estimator_baseline.py --n 5000           # sub-muestra, para iterar rápido
```

Features: rareza, `cmc`, cantidad de colores, tipo primario (creature/instant/
etc.), legendaria o no, año/antigüedad, `set_type`, `frame`, `border_color`,
disponibilidad de foil/etched, cantidad de `frame_effects`. Target:
`prices.usd`, entrenado en escala `log1p` (el precio está muy sesgado: la
mayoría de las cartas son bulk de centavos, pocas cuestan cientos de dólares).

**Resultado de la corrida real (RandomForest, dataset completo, 41,298 train /
10,325 test):**

| Métrica | Valor |
|---|---|
| MAE (USD) | $2.59 |
| Median AE (USD) | $0.20 |
| RMSE (USD) | $45.23 |
| R² (USD) | 0.191 |
| R² (log-USD) | 0.521 |

El modelo acierta bien el grueso de cartas baratas (Median AE de 20 centavos)
pero pierde precisión en las "chase cards" caras (RMSE en USD dominado por
esos pocos casos de cientos/miles de dólares) — visible en
`output/price_baseline/latest/pred_vs_actual.png`, donde la nube se pega a la
diagonal en la zona barata y se dispersa arriba de ~$50. `feature_importance.png`
muestra que `rarity` (rare/mythic), antigüedad/año y `cmc` son las señales más
fuertes — tiene sentido con la intuición de mercado de MTG. Es exactamente el
tipo de resultado que la sección 2 (selección de mejor framework por etapa)
va a tener que superar con el embedding visual sumado.

> El `RandomForestRegressor` original no limitaba `max_depth` (300 árboles
> sin tope) — entrenaba un pipeline de ~800 MB en disco memorizando filas
> individuales en vez de generalizar, sin mejora real de R². Acotar
> `max_depth=18` + `min_samples_leaf=3` (200 árboles) bajó el modelo a ~90 MB
> y **subió** R²(log-USD) de 0.454 a 0.521 — menos overfitting, no solo menos
> peso en disco.

Artefactos: `output/price_baseline/{timestamp}/` (metrics + gráficos,
versionado, igual que Certamen 1) y `models/price_baseline_model.joblib`
(binario del pipeline entrenado, ~90 MB — **gitignored**, no versionado,
mismo criterio que `pytorch/models/` y `tensorFlow/models/` en Certamen 1).

### 5.1.1 Diseño del feature vector combinado — Stage 3 "de verdad" (15 ago)

Antes de escribir `pytorch/15_price_estimator.py` / `tensorFlow/13_price_estimator.py`
(ver checklist, sección 6), queda fijado acá el contrato del feature vector
que van a compartir ambos frameworks — mismo espíritu que `HashingVectorizer`
para Stage 2 (regla 4 de CLAUDE.md): la mitad tabular tiene que ser **byte-
idéntica** entre PyTorch y TensorFlow para que la comparación cross-framework
(sección 2) aísle la diferencia real (backbone/cabeza), no un artefacto de
cómo cada framework codificó la metadata.

```
x = concat(x_tab, x_vis)
```

**`x_tab` — mitad tabular (idéntica en ambos frameworks, 48 dims)**

Nuevo módulo `price_features.py`, Python puro (sin `torch`/`tf`/`sklearn`),
duplicado byte-idéntico en `pytorch/src/` y `tensorFlow/src/` — mismo
criterio que ya usa `src/text_matcher.py` en las dos carpetas, no
centralizado en `ml/data-prep/`. Reutiliza el feature set ya probado de
`price_estimator_baseline.py::fila_features()` (rareza, `cmc`, colores, tipo
primario, legendaria, antigüedad, `set_type`, `frame`, `border_color`, foil/
etched, `frame_effects`) pero reemplaza el `OneHotEncoder` de `sklearn`
(fit-time, estado que habría que persistir y sincronizar entre frameworks)
por **vocabularios fijos hardcodeados + bucket "other"** — mismo principio
que ya usan los one-hot manuales de color/tipo en el baseline, extendido a
las 4 columnas categóricas restantes:

| Categoría | Vocabulario fijo (orden fijo) | # dims (vocab + "other") |
|---|---|---|
| `rarity` | common, uncommon, rare, mythic, special, bonus | 7 |
| `set_type` | expansion, masters, commander, draft_innovation, core | 6 |
| `frame` | 2015, 2003, 1997, 1993, future | 6 |
| `border_color` | black, borderless, white, yellow | 5 |

(vocabularios sacados de un `Counter` real sobre los 58,679 registros de
`cards.json`, 15 ago — hoy son exhaustivos, el bucket "other" es solo
defensivo para cuando Scryfall agregue un `set_type`/`frame` nuevo).

Más 9 campos numéricos/binarios sin encoding (`cmc`, `n_colores`,
`es_incoloro`, `es_legendaria`, `n_frame_effects`, `tiene_foil`,
`tiene_etched`, `anio`, `antiguedad_anios`) + 15 one-hot ya hardcodeados
(5 colores + 10 tipos primarios, igual que el baseline) = **48 dims totales**
(9 + 15 + 24).

Normalización: los 5 campos numéricos sin acotar (`cmc`, `n_colores`,
`n_frame_effects`, `anio`, `antiguedad_anios`) se estandarizan con media/
desvío calculados **una vez** sobre el split de train y persistidos en
`ml/data-prep/data/price_dataset/tabular_scaler.json` — no un objeto
`StandardScaler` pickleado (no portable entre `sklearn` de dos venvs
distintos, tampoco exportable a ONNX), solo los números, aplicados igual en
los dos frameworks. Las columnas binarias/one-hot quedan en 0/1 crudo.

**`x_vis` — embedding visual (nativo por framework, no se fuerza a que
tengan la misma dimensión)**

Reusa el backbone **ya fine-tuneado de Stage 1** (`mtg_detector.pth` /
`mtg_detector.keras`, ambos ya en disco), completamente congelado — no
`freeze_ratio` parcial como Stage 4, acá es un extractor de features puro:

- **PyTorch**: `MTGDetector.features` + `.avgpool` + `.flatten` (se descarta
  `.head`), `requires_grad=False` en todo el backbone, `.eval()` siempre →
  vector de **1280 dims**.
- **TensorFlow**: el submodelo `MobileNetV3Small` de `mtg_detector.keras`
  con `pooling='avg'` (se descarta la cabeza de clasificación),
  `trainable=False` → vector de **576 dims** (verificado corriendo el
  modelo real, 15 ago — no 1024, que era una suposición incorrecta de un
  borrador anterior de este plan).

Dimensión final combinada: **1328** (PyTorch, 48+1280) vs. **624**
(TensorFlow, 48+576) — distinta por framework, y está bien: es la misma
situación que ya existe hoy en Stage 1/4 (`EfficientNet_b0` vs.
`MobileNetV3Small`, cada uno con su propia dimensión de salida). Lo único
que tiene que ser idéntico es `x_tab`.

Como el backbone está congelado, su salida es una función determinística de
la imagen — no hace falta recalcularla en cada epoch. Se precalcula **una
sola vez** por framework y se cachea en disco (mismo criterio que evitar
re-correr OCR en cada epoch de Stage 2):
`ml/data-prep/data/price_dataset/{framework}_visual_embeddings.npy` +
`card_ids.json`. Esto requiere un script de preparación nuevo,
`ml/data-prep/prepare_price_dataset.py` (corre una vez por framework, dentro
del venv correspondiente porque importa `torch` o `tf`) — todavía no
escrito, queda como prerrequisito de B2/B3 (ROADMAP.md, workstream B) y es
exactamente el "futuro prep script de Stage 3" que ya anticipaba la nota de
C1 en ROADMAP.md.

**Split**: partición fija train/val/test por `card_id`, guardada en
`ml/data-prep/data/price_dataset/split.json` (seed fija) — para que ambos
frameworks entrenen/evalúen sobre exactamente las mismas cartas, no solo
sobre la misma proporción (más fuerte que el `train_test_split(random_state=42)`
independiente que usa hoy el baseline). Hace falta un val set separado del
test para Optuna (B4) — el baseline de hoy solo tiene train/test.

**Target y métricas**: igual que el baseline (`log1p(prices.usd)`, filtrado a
`usd > 0`; reportado en escala log y en USD — MAE, Median AE, RMSE, R²) para
que los números del modelo real sean directamente comparables contra el piso
ya medido en 5.1 (MAE $2.59, R²(USD) 0.191, R²(log-USD) 0.521).

**Pendiente para B2/B3 (no es parte de este diseño, queda anotado)**:
aplicar el patrón `--device {auto,cpu,cuda}` de CLAUDE.md regla 1 desde el
arranque en `pytorch/15_price_estimator.py` y en `prepare_price_dataset.py`
— no esperar a pegarse con el bug de ROCm como pasó con Stage 2.

### 5.1.2 Stage 3 "de verdad" — primera corrida real (15 ago)

Escritos y corridos de punta a punta los scripts que implementan el diseño
de 5.1.1: `ml/data-prep/prepare_price_dataset.py` (tabular + split + scaler) →
`pytorch/prepare_price_embeddings.py` / `tensorFlow/prepare_price_embeddings.py`
(embedding visual congelado, uno por framework) →
`pytorch/15_price_estimator.py` / `tensorFlow/13_price_estimator.py`
(entrenamiento). Nuevos módulos compartidos: `src/price_features.py`
(vectorizador tabular, duplicado byte-idéntico en ambos frameworks — mismo
criterio que `text_matcher.py`) y `src/price_regressor.py` (MLP de
regresión, API funcional en TensorFlow por el mismo motivo que
`text_matcher.py`).

Corrida de verificación con `--n 1500` (sub-muestra, no el dataset completo
— ver nota abajo), split 70/15/15 por `card_id` (1,050/225/225):

| Métrica (test set) | PyTorch | TensorFlow | Baseline tabular (5.1, dataset completo) |
|---|---|---|---|
| MAE (USD) | $3.53 | $3.17 | $2.59 |
| Median AE (USD) | $0.26 | $0.33 | $0.20 |
| RMSE (USD) | $12.76 | $12.88 | $45.23 |
| R² (USD) | 0.025 | 0.006 | 0.191 |
| R² (log-USD) | 0.107 | 0.197 | 0.521 |

`input_dim` confirmado exactamente como predijo el diseño: PyTorch 1328
(48 tabular + 1280 visual), TensorFlow 624 (48 + 576). Ambos scripts
completan las 40 épocas, guardan el mejor checkpoint (`models/price_regressor.pth`
/ `.keras` + `_cfg.json`), versionan resultados bajo `output/{framework}/price_estimator/`
y grafican `pred_vs_actual.png`/`training_curve.png` — el pipeline end-to-end
funciona.

**Por qué el R² sale peor que el baseline acá** (esperado, no un bug): esta
corrida es a propósito una sub-muestra de 1,500 cartas (1,050 de train) para
verificar que el pipeline completo funciona, no para medir el modelo real —
el baseline tabular de 5.1 entrenó sobre 41,298 cartas. Con ~27x menos datos
de train y una red con ~0.37M parámetros, el modelo real memoriza el
train set (`train_mse` cae a ~0.05-0.07 en log-space mientras `val_mse` se
estanca en ~0.47) en vez de generalizar — overfitting típico de "poca data,
red con capacidad de sobra", no una falla del diseño del feature vector.
Corrida a full dataset (~51,600 cartas con precio) queda pendiente, junto
con Optuna (B4) — normal a esta escala, según la regla operativa de la
sección 2: la primera palanca ante una métrica floja es sumar más datos
antes de tocar arquitectura/hiperparámetros.

### 5.1.3 B6 — feature `edhrec_rank` (15 ago, ROADMAP.md workstream B)

El sweep de Optuna de B4 (20 trials, ambos frameworks) plateaba en
R²(log-USD) 0.430–0.441 sin importar los hiperparámetros, mientras el train
loss seguía bajando — techo de información, no falta de tuning ni de datos
(ya se entrena sobre ~90% del catálogo real). Diagnóstico: las 48 dims
tabulares (`rarity`/`set_type`/`frame`/`border_color`, sin señal de
identidad de carta) no distinguen una común de $0.10 de una rara "chase" de
$40 con las mismas columnas categóricas — el precio lo mueve demanda/
escasez, no capturado hasta ahora.

Fix: `edhrec_rank` de Scryfall (más bajo = más jugada/popular en EDH/
Commander) agregado a `cards.json` vía `ml/training/merge_edhrec_rank.py` —
**no** vía `01_scraper.py` (destructivo, trunca a `--max-cards`, CLAUDE.md
regla 2) — reusando el cache local `data/raw_cards.json` del scrape original
(ya trae `edhrec_rank` para 101,909/116,703 filas crudas, 87.3%, sin
necesidad de volver a pegarle a la red). `price_features.py` (ambas copias)
ganó 2 campos nuevos: `edhrec_rank_conocido` (binario) + `edhrec_rank_log`
(`log1p(rank)`, estandarizado con el mismo mecanismo de
`tabular_scaler.json` que el resto de los campos numéricos, placeholder 0.0
cuando no se conoce el rank). `x_tab` pasa de **48 a 50 dims** — el flag de
"conocido" es necesario porque no toda carta tiene `edhrec_rank` en
Scryfall, y sin él un placeholder numérico se confundiría con una señal real
de popularidad extrema.

Cascada re-corrida completa (mismo orden que 5.1.2):
`merge_edhrec_rank.py` → `prepare_price_dataset.py` (regenera `cards.csv`/
`tabular_scaler.json` con las 2 columnas nuevas — split idéntico al de antes,
determinístico, no depende de `edhrec_rank`) → `15_`/`13_price_estimator.py`
→ `17_`/`15_optuna_price_estimator.py` → `18_`/`16_export_onnx_price_estimator.py`.
Los embeddings visuales cacheados (`{framework}_visual_embeddings.npy`) no
se tocan — son independientes de la mitad tabular.

**Resultado (dataset completo, 51,939 cartas, mismo split que 5.1.2 — 36,359/
7,790/7,790):**

| Métrica (test set, log-space R²) | Antes de B6 (48 dims) | Después de B6 (50 dims) | Baseline tabular (5.1) |
|---|---|---|---|
| PyTorch — plano | 0.427 | 0.651 | — |
| PyTorch — Optuna | 0.441 | **0.658** | — |
| TensorFlow — plano | 0.427 | 0.648 | — |
| TensorFlow — Optuna | 0.430 | **0.649** | — |
| Referencia | | | 0.521 |

`edhrec_rank` era efectivamente el techo de información que B4 no podía
resolver con hiperparámetros: el Optuna post-B6 apenas mueve el número
respecto al entrenamiento plano (0.651→0.658 PyTorch, 0.648→0.649
TensorFlow) — el salto grande lo da agregar la feature, no tunearla. Ambos
frameworks ahora superan claramente el piso del baseline tabular (0.521),
algo que ninguno lograba antes de B6. R²(USD) se mantiene bajo (0.176
PyTorch, 0.025 TensorFlow Optuna) — esperado, mismo artefacto de sesgo de
precio que documenta H3, no empeoró ni mejoró de forma relevante respecto a
antes de B6.

`input_dim` confirmado tras el re-export: PyTorch 1330 (50+1280), TensorFlow
626 (50+576) — paridad numérica ONNX limpia (2.98e-08/0.00e+00, ambas muy
por debajo de la tolerancia 1e-4).

### 5.2 Baseline de Stage 2 — `text_validator_baseline.py`

Mismo espíritu que 5.1 pero para el validador de texto: un baseline sin
modelo propio entrenado (**OpenCV + OCR + similitud de strings**), antes de
construir las dos versiones "de verdad" por framework.

```bash
cd ml/data-prep
python text_validator_baseline.py                # 800 cartas de muestra
python text_validator_baseline.py --n 200          # muestra chica, iterar rápido
```

Pipeline: `card_preprocessing.py` (localizar carta + corregir perspectiva +
normalizar contraste — ver sección 8) → recorte fijo de la caja de texto
dentro de la carta ya encuadrada → OCR con `pytesseract` → similitud
(`difflib`) contra `name` + `oracle_text` de la carta candidata. Descarga su
propia sub-muestra en calidad "large" (`ml/data-prep/data/ocr_images/`,
gitignored) — las imágenes "small" del dataset compartido (146×204px) son
ilegibles para OCR.

**Resultado de la corrida real (800 cartas, 1600 pares positivo/negativo):**

| Métrica | Valor |
|---|---|
| ROC-AUC | 0.818 |
| Accuracy (umbral óptimo) | 0.823 |
| Score promedio — positivo | 0.496 |
| Score promedio — negativo | 0.164 |

Un baseline sin modelo propio entrenado separa positivos de negativos con
AUC ~0.82 — señal fuerte de que el enfoque (OCR + comparación de texto) es
viable antes de invertir en un clasificador entrenado. `ejemplos_ocr.png` en
`output/text_validator_baseline/latest/` muestra que el OCR lee texto real y
legible (ej. "If a Giant source you control would deal damage to a
permane…" para *Calamity Bearer*, calzando exacto con su `oracle_text`).

### 5.3 Demo del flujo completo — `full_pipeline_demo.py`

Encadena Stage 1 (`pytorch/scanner.py`, subproceso) → Stage 2 → Stage 3 sobre
una sola foto, con lo que existe hoy (baselines, no los modelos "de verdad"):

```bash
cd ml/data-prep
python full_pipeline_demo.py ruta/a/carta.jpg
```

Corrida real sobre una foto de celular de *Bastion of Remembrance* encontró
un bug real en el camino: Stage 1 identificó mal la carta (58.1% de
similitud, correctamente marcada `NO_MAGIC`) porque
`pytorch/data/index_pt.json` — la galería de embeddings donde busca Stage 1 —
sigue siendo el subconjunto de 5,000 cartas de los inicios de Certamen 1;
*Bastion of Remembrance* existe en el dataset actual de 58k pero nunca se
re-indexó. Stage 2 leyó el texto real por OCR y correctamente marcó que no
confirmaba al candidato equivocado de Stage 1 — exactamente la redundancia
que Stage 2 está diseñado para dar. Pendiente (no bloqueante, necesita GPU):
reconstruir el índice de PyTorch contra el dataset completo
(`pytorch/03_pt_embedder.py --force`).

## 6. Qué falta para arrancar (roadmap)

- [x] Extender `CAMPOS` con `oracle_text`, `prices`, `frame`, `border_color`,
      `frame_effects`, `finishes`.
- [x] Re-scrapear / backfill del dataset compartido (58,174 impresiones).
- [x] Baseline tabular de Stage 3 (`price_estimator_baseline.py`) — hecho, ver
      sección 5.1.
- [x] Descarga de imágenes completa (`02_downloader.py`): 58,174/58,174.
- [x] Baseline OCR de Stage 2 (`text_validator_baseline.py`) — hecho, ver
      sección 5.2.
- [x] Demo del flujo completo (`full_pipeline_demo.py`) encadenando Stage
      1→2→3 sobre una foto — con los baselines de hoy, no los modelos
      "de verdad" todavía.
- [x] Optuna sobre Stage 1 en ambos frameworks (sección 0).
- [x] Exportar Stage 1 PyTorch a ONNX (`pytorch/09_export_onnx.py`).
- [x] Migrar TensorFlow de MobileNetV2 a MobileNetV3Small en Stage 1 (8 ago,
      ver sección "Stage 1 — Detector MTG/no-MTG" arriba: +14.5 pts de top-1
      retrieval accuracy). Stage 4 ya nació en V3Small. Falta Stage 2/3, que
      todavía no tienen versión "de verdad" con backbone (siguen en baseline,
      ver ítems de abajo).
- [ ] Reconstruir `pytorch/data/index_pt.json` (embeddings) contra el dataset
      completo — sigue en su subconjunto original de 5,000 cartas, causa
      identificaciones erróneas evitables (encontrado corriendo
      `full_pipeline_demo.py`, ver sección 5.3).
- [x] Script de entrenamiento Stage 2, ambos frameworks — versión "de verdad",
      no el baseline: `pytorch/14_text_validator.py` +
      `tensorFlow/12_text_validator.py`, `src/text_matcher.py` en cada
      framework (HashingVectorizer idéntico en ambos). Entrenado sobre datos
      reales (791 cartas, `prepare_text_validator_dataset.py`): PyTorch
      ROC-AUC 0.9608, TensorFlow 0.9565 (sin Optuna). Ver ROADMAP.md,
      workstream A.
- [x] Stage 3 "de verdad" por framework (`pytorch/15_price_estimator.py` +
      `tensorFlow/13_price_estimator.py`), sumando el embedding visual al
      baseline tabular de la sección 5.1 — ver sección 5.1.2. Corrida de
      verificación (`--n 1500`) confirma que el pipeline completo funciona
      de punta a punta (R²(log-USD) 0.107 PyTorch / 0.197 TensorFlow, por
      debajo del baseline por ser una sub-muestra chica, no un problema de
      diseño). Falta: correr sobre el dataset completo y aplicar Optuna
      (B4, ver ROADMAP.md).
- [x] Aplicar Optuna a Stage 2 (`pytorch/15_optuna_text_validator.py` +
      `tensorFlow/13_optuna_text_validator.py`) — PyTorch 0.9646 ROC-AUC,
      TensorFlow 0.9634 (empate por el criterio de `scripts.service.ts`,
      diff < 0.005).
- [ ] Aplicar Optuna a Stage 3 una vez tenga un baseline entrenando (mismo
      patrón que la sección 0).
- [x] Exportar Stage 2 a ONNX, ambos frameworks
      (`pytorch/16_export_onnx_text_validator.py` +
      `tensorFlow/14_export_onnx_text_validator.py`), publicado como
      `stage2-text-validator.onnx` en `apps/mobile/public/models/`.
- [ ] Exportar Stage 3 a ONNX y armar el registro `best_model.json` por etapa
      (sección 2) — todavía no existe para ninguna etapa, la selección de
      "ganador" hoy es manual/última corrida publicada.
- [x] Métricas de Stage 2 reportadas arriba (ROC-AUC, umbral de Youden,
      accuracy). Pendiente: MAE / RMSE / R² del estimador de precio (Stage 3)
      sobre un hold-out, una vez exista el modelo real.
- [x] `card_preprocessing.py`: localizar carta + corregir perspectiva +
      normalizar contraste, compartido entre Stage 2 y Stage 4 — ver sección 8.
- [x] Condición de la carta: stopgap por regla (`--condition` + multiplicador)
      implementado — ver sección 7.
- [x] Stage 4 — clasificador de condición, ambos frameworks entrenados,
      evaluados y **conectado a Stage 3** en `full_pipeline_demo.py`
      (PyTorch 0.7475 acc, TensorFlow 0.6550 acc) — ver sección 9. Sobre una
      foto real predijo HP con 63.8% confianza — plausible pero no
      verificado, entrenado 100% sobre desgaste sintético todavía.
      Datasets públicos reales (Roboflow) sin verificar/descargar.

## 7. Por qué este enfoque

Se descartó una alternativa más simple (ver discusión en el chat del
proyecto):
- **Solo estimador de precio** (sin el validador de texto) — es un flujo de un
  solo modelo nuevo, no dos, y no ataca el problema real de identificación
  ambigua que puede tener el sistema de Certamen 1.

Un **detector de daño/condición de la carta** se consideró y se descartó
inicialmente por el mismo motivo (dataset etiquetado por condición que no
teníamos) — pero se retomó el 7 de agosto: la condición de una carta es un
concepto visual genérico (scratches, whitening de bordes, esquinas
redondeadas), no específico de Magic, así que no hace falta un dataset
MTG-only para entrenarlo. Ver sección 9 — es ahora Stage 4 del pipeline,
también por framework.

Combinar validador de texto + estimador de precio da dos modelos genuinamente
encadenados (la salida de uno es prerequisito del otro) resolviendo un problema
concreto. Duplicar cada etapa en ambos frameworks y compararlos por métrica
(sección 2), en vez de comprometerse a uno solo desde el inicio, deja elegir
el mejor de cada etapa con datos en vez de a priori — y ONNX (sección 3)
hace que esa elección no ate la app final a un solo framework.

## 8. OpenCV — localización y normalización de la carta

Hasta el 7 de agosto, OpenCV solo se usaba dentro de Stage 2 (`recortar_texto`
en `text_validator_baseline.py`) y ahí nomás para *preparar* la imagen para
OCR (grayscale, upscale, threshold) — nada del pipeline hacía el trabajo de
"encontrar la carta dentro de una foto real con fondo alrededor", pese a que
el diagrama de arquitectura (sección 1) y el plan del examen ya lo daban por
hecho. Cada etapa asumía que la imagen de entrada ya era "solo la carta"
— cierto para los renders de Scryfall, falso para una foto de celular real.

`card_preprocessing.py` (nuevo) hace ese trabajo una sola vez, compartido
entre Stage 2 y el nuevo Stage 4 (sección 9): localizar el rectángulo de la
carta en la foto, corregir perspectiva (`cv2.getPerspectiveTransform` +
`warpPerspective`) a un tamaño canónico fijo (750×1050), y normalizar
contraste (CLAHE). Es el equivalente en Python de lo que hará OpenCV.js del
lado del cliente en la app Ionic — mismo algoritmo, referencia para portar
a JS más adelante.

**Cómo se llegó al algoritmo actual (vale la pena registrar el camino, no
solo el resultado):**

1. Primer intento: Canny + `approxPolyDP` buscando un contorno de 4 lados
   ("document scanner" clásico). Falló en la primera foto real de prueba
   (celular, carta en funda plástica sobre tela oscura) — el borde real de
   la carta contra el fondo tiene muy poco contraste de luminancia, así que
   casi no aparece en el mapa de edges, mientras que una zona con textura
   brillante en una esquina del fondo generaba ruido que dominaba como
   "contorno más grande".
2. Segundo intento: mismo Canny, pero `minAreaRect` sobre el contorno externo
   más grande en vez de exigir una aproximación poligonal limpia a 4 puntos
   (más tolerante a bordes imperfectos). Mismo problema de fondo: seguía sin
   encontrar nada, porque el problema no era la forma del contorno sino que
   Canny no detectaba el borde real en absoluto.
3. Diagnóstico visual (guardar y mirar el mapa de edges): confirmó que era
   un problema de segmentación (carta más clara que el fondo, no un borde
   nítido) — no un problema de tracing de contornos. Cambio a Otsu sobre
   brillo (`cv2.threshold(..., THRESH_OTSU)`) + apertura/cierre morfológico
   para limpiar ruido, en vez de Canny. Esto sí localizó la carta
   correctamente en la foto de prueba real.
4. Pero al validar contra el corpus real (`text_validator_baseline.py`,
   renders de Scryfall), el ROC-AUC bajó de 0.833 a 0.742 — la detección por
   Otsu enganchaba la caja de ilustración interna de la carta (que por
   casualidad comparte aspect ratio con la carta completa) en vez de fallar
   limpiamente a "no encontré nada", porque esas imágenes no tienen fondo
   real contra el cual segmentar. Se probaron filtros de área, solidez
   (`contourArea/hull area`) y extent (`contourArea/minAreaRect area`) para
   distinguir ese falso positivo de una detección real — ninguno separaba
   limpiamente los dos casos (el falso positivo medía *mejor* solidez que la
   detección real y buena sobre la foto de celular).
5. Solución final, más honesta que seguir ajustando umbrales: en vez de que
   el módulo intente adivinar "¿esta imagen tiene fondo real o no?", quien
   llama lo declara. `normalizar_carta(..., intentar_localizar=bool)` —
   `text_validator_baseline.py` pasa `False` (siempre procesa renders
   pre-recortados, la detección no aporta y a veces daña), `full_pipeline_demo.py`
   pasa `False` para Stage 2 vía `es_render_pre_recortado=False` en fotos
   reales. Con este flag, el ROC-AUC de Stage 2 volvió a 0.818 (n=800, dentro
   del ruido de la corrida original) y la foto de celular real sigue
   localizando y enderezando la carta correctamente.

**Limitación conocida, sin resolver:** la detección por contornos (Otsu +
`minAreaRect`) es una heurística clásica, no un modelo entrenado — funciona
en la foto de prueba que tenemos, pero no hay garantía de que generalice a
fondos muy distintos (mesas claras, fondos con patrones, ángulos extremos).
Los datasets encontrados para Stage 4 (sección 9) probablemente vengan con
sus propias fotos ya razonablemente encuadradas, así que esto no bloquea ese
trabajo, pero es la pieza más frágil de todo el preprocesamiento y candidata
a reemplazar por un detector entrenado (o al menos afinar con más fotos
reales de prueba) más adelante — no algo que un curso necesite resolver a la
perfección, pero sí algo para no perder de vista en la interrogación oral.

## 9. Modelo nuevo 3 — Clasificador de condición (Stage 4)

Motivación (7 de agosto): el estimador de precio (Stage 3) predice un precio
de referencia (esencialmente near-mint, ver sección 7) sin ninguna señal de
la condición física real de la carta fotografiada — hoy eso se tapa con un
multiplicador declarado por el usuario (`--condition`, sección 7). Un
clasificador visual de condición de verdad cierra ese hueco, y a diferencia
de lo que se pensó originalmente, **no hace falta un dataset de Magic para
entrenarlo** — desgaste (scratches, whitening de bordes, esquinas
redondeadas, dobleces) es un concepto visual genérico, igual en una carta de
Magic que en una de Pokémon o un card deportivo.

Es Stage 4: corre **en paralelo con Stage 1**, no después — ambos consumen la
misma carta ya localizada/normalizada por `card_preprocessing.py` (sección
8), y ninguno de los dos necesita saber qué etapa produjo qué primero. Su
salida (grado de condición) se suma a Stage 3 como feature adicional, además
del input manual que ya existe.

```
                    foto ─▶ card_preprocessing.py (localizar + normalizar)
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                                 ▼
   Stage 1 — Detector + retrieval        Stage 4 — Clasificador de condición
   (¿qué carta es?)                      (¿en qué estado está?)
                    │                                 │
                    └───────────────┬───────────────┘
                                    ▼
                    Stage 2 — Validador de texto (¿confirma?)
                                    │
                                    ▼
                    Stage 3 — Estimador de precio (metadata + condición → USD)
```

**Datos — no se necesitó scrapear nada nuevo, ya existen datasets públicos
para exactamente este problema** (buscado el 7 de agosto):

- [MTG Card Grading (Roboflow Universe)](https://universe.roboflow.com/stall-ysun2/mtg-card-grading)
  — 335 imágenes de daño en cartas MTG, específico, listo para usar.
- [Card Grader (Roboflow Universe)](https://universe.roboflow.com/group-6-major-project/card-grader)
  — cross-TCG (deportivas, Pokémon, MTG), grados por Edge Wear / Scratch /
  Corner Wear — confirma que el desgaste generaliza entre juegos de cartas.
- [Stanford CS230 — "MTG Card Grader Using Image Classification and Detection"](http://cs230.stanford.edu/projects_spring_2020/reports/38794151.pdf)
  — mismo problema exacto, bins NM / LP / HP / Damaged (casi idénticos a
  `CONDITION_MULTIPLIERS`), referencia de metodología.
- [rthorst/mint_condition (GitHub)](https://github.com/rthorst/mint_condition)
  — ~90k fotos de eBay de cartas *ya gradeadas profesionalmente* (PSA/BGS,
  grado visible en la funda de la foto) — la fuente de labels más confiable
  si algún día hace falta más volumen que los datasets de arriba. No se
  persiguió todavía — antes de scrapear eBay para esto, agotar lo que ya es
  público y gratis (los tres puntos anteriores). **Verificar licencia** de
  cada dataset de Roboflow antes de usarlo — no asumida acá.

**Arquitectura**: mismo patrón que las demás etapas — transfer learning sobre
el mismo backbone por framework. PyTorch usa `EfficientNet_b0` (igual que
Stage 1); TensorFlow usa **`MobileNetV3Small`** directamente — al momento de
construir Stage 4, Stage 1 todavía estaba en MobileNetV2 (ver sección 1;
migró recién el 8 ago), así que no tenía sentido construir Stage 4 sobre V2
para migrarlo después. Con la migración de Stage 1 ya hecha, los cuatro
modelos TensorFlow del proyecto comparten backbone. Cabeza de clasificación
de 5 salidas (softmax) en vez de la cabeza
binaria de Stage 1 — `pytorch/src/condition_classifier.py` y
`tensorFlow/src/condition_classifier.py`, mismo patrón que
`src/binary_classifier.py` en ambos frameworks (freeze_ratio/head_units/
dropout parametrizados, listo para Optuna después).

**Entrenado y evaluado (7 ago), resultado real (hiperparámetros fijos):**

| Framework | Backbone | Accuracy | F1 (macro) |
|---|---|---|---|
| PyTorch | EfficientNet_b0 | **0.7475** | 0.7442 |
| TensorFlow | MobileNetV3Small | 0.6550 | 0.6603 |

**Optuna sobre Stage 4 (7 ago, mismo patrón que sección 0 — 20 trials, TPE +
MedianPruner, `trial-epochs=6`, `final-epochs=15`):**

| Framework | Accuracy fijo → Optuna | F1 macro fijo → Optuna | Mejor trial |
|---|---|---|---|
| PyTorch | 0.7475 → **0.9525** (+20.5 pts) | 0.7442 → **0.9523** | trial 13/20: lr=6.41e-4, adam, head_units=448, dropout=0.35, weight_decay=4.00e-5, freeze_ratio=0.5, batch_size=16 |
| TensorFlow | 0.6550 → **0.7575** (+10.3 pts) | 0.6603 → **0.7546** | trial 12/20: lr=6.23e-4, adam, head_units=512, dropout=0.5, freeze_ratio=0.5, batch_size=16 |

Ambos frameworks mejoran sensiblemente con Optuna — sus hiperparámetros
fijos (heredados de Stage 1) dejaban mucho sobre la mesa para 5 clases con
límites de decisión más finos que la binaria NM/no-NM. PyTorch da el salto
más grande por lejos: **95.25% de accuracy** sobre el split sintético
(mismo tipo de techo alto-en-datos-curados que Stage 1 con Optuna, sección
0 — hay que validar contra fotos reales antes de confiar en el número
final), ampliando su ventaja sobre TensorFlow en esta etapa de ~9 a
**~17.5 puntos**. Ambas recetas ganadoras convergen a la misma
región del espacio (lr ~6e-4, adam, freeze_ratio=0.5, batch_size=16,
dropout 0.35–0.5) — señal de que no es ruido del sampler sino una zona
genuinamente buena para esta tarea, aunque PyTorch la explota mucho mejor
(métricas por grado balanceadas, el peor recall es LP con 88.1%; ver
`por_grado` en `final_metrics.json`). Resultados completos, matrices de
confusión e importancia de hiperparámetros en
`output/{pytorch,tensorflow}/optuna_condition/latest/`.

Dataset: 800 cartas base × 5 grados = 4,000 imágenes sintéticas
(`synthetic_wear.py`), split 80/20 **por carta** (no por imagen — las 5
variantes de una misma carta comparten arte/composición; splitear por imagen
dejaría la misma carta en train y val, y el modelo podría aprender a
reconocer la carta en vez del desgaste). PyTorch gana esta etapa por ~9
puntos — primer dato real para la sección 2 (selección de mejor framework
por etapa): no necesariamente el mismo framework gana las tres/cuatro
etapas, y acá no ganó el mismo que en Stage 1 vs. cómo venía TensorFlow
tradicionalmente en el curso.

Ambas matrices de confusión (`output/{pytorch,tensorflow}/condition_grader/latest/confusion_matrix.png`)
muestran el mismo patrón sano: casi todos los errores son entre grados
**adyacentes** (NM↔LP, MP↔HP, HP↔DMG) — prácticamente cero confusión entre
grados lejanos (NM nunca se confunde con DMG). El modelo está aprendiendo la
estructura ordinal real del desgaste, no ruido — y los errores que comete son
del tipo menos grave posible (una carta HP predicha como MP, no como NM).

**Conectado a Stage 3 (7 ago)**: `pytorch/predict_condition.py` (nuevo) carga
el modelo ganador (PyTorch) y expone una salida parseable, en el mismo
espíritu que `scanner.py`. `full_pipeline_demo.py` lo corre como Stage 4 —
en paralelo con Stage 1, sobre la carta ya localizada/normalizada por
`card_preprocessing.py` (mismo motivo que Stage 1/2: el modelo se entrenó
sobre recortes limpios, no fotos con fondo) — y usa su predicción como
condición por default en Stage 3, en vez del valor fijo `NM` de antes.
`--condition` sigue existiendo como override manual, no desactiva Stage 4,
solo lo ignora para el cálculo de precio. **Actualizado (8 ago)**: carga
`condition_grader_combined.pth`, no el sintético-solo — ver comparación
cabeza a cabeza más abajo, la razón por la que se hizo el cambio.

**Primer resultado real sobre una foto real, y una limitación honesta**:
sobre la foto de celular de *Bastion of Remembrance* (la misma que reveló el
índice de embeddings desactualizado, sección 5.3), Stage 4 predijo **HP
(Heavily Played) con 63.8% de confianza**. Plausible, pero no verificable acá
— y hay una razón concreta para no tomarlo al pie de la letra todavía: el
modelo entrenó *exclusivamente* con desgaste sintético (`synthetic_wear.py`)
sobre renders limpios, nunca vio artefactos reales de fotografía (brillo de
funda, blur de cámara, gradientes de luz) durante el entrenamiento — esos
artefactos pueden leerse como "desgaste" sin que la carta esté realmente
dañada. Mismo patrón que la caída de 100%→90.8% de Stage 1 sobre esta misma
foto (sección 0): el techo medido en datos curados no es una garantía sobre
fotos reales. Es exactamente el tipo de caso donde complementar con fotos
reales (datasets de Roboflow, ítem de abajo) importaría más que seguir
puliendo el bootstrap sintético.

**Qué falta:**
- [x] Aumentación sintética de desgaste con OpenCV (`synthetic_wear.py`):
      scratches, whitening de bordes, esquinas redondeadas, crease, manchas —
      5 grados (NM/LP/MP/HP/DMG), intensidad creciente por grado.
- [x] Script de preparación de dataset (`prepare_condition_dataset.py`):
      escalado a 800 cartas × 5 = 4,000 imágenes (antes probado a 40 cartas).
- [x] Script de entrenamiento por framework — `pytorch/10_condition_grader.py`
      y `tensorFlow/09_condition_grader.py`, mismo patrón de
      `07_binary_classifier.py`. Corrida real completada para ambos, ver
      tabla arriba.
- [x] Conectar la salida a Stage 3 (`pytorch/predict_condition.py` +
      `full_pipeline_demo.py`) — hecho, ver arriba. `--condition` queda como
      override manual.
- [x] Verificar licencias y descargar los datasets de Roboflow — **ambos son
      CC BY 4.0** (confirmado vía la API REST de Roboflow; el SDK de Python
      no expone el campo `license` en su modelo de objetos, hubo que pegarle
      directo a `api.roboflow.com/{workspace}/{project}`). Requiere una API
      key personal (gratis, cuenta propia) — no se versiona, va en
      `ml/data-prep/.env` (gitignored).
- [x] `import_roboflow_condition_data.py`: los dos datasets vienen anotados
      para **detección de objetos** (cajas marcando dónde hay daño —
      "Dano"/Scratch/Edge Wear/Corner Wear), no para clasificación de carta
      completa como NM/LP/MP/HP/DMG — no hay mapeo directo. Heurística:
      contar cajas de daño por imagen, convertir el conteo a grado con
      umbrales por cuartiles de la distribución real de cada dataset
      (`mtg-card-grading`: 0→NM, 1–12→LP, 13–18→MP, 19–33→HP, 34+→DMG;
      `card-grader` cross-TCG: 0→NM, 1–4→LP, 5–7→MP, 8–11→HP, 12+→DMG —
      escalas distintas porque un dataset anota daño mucho más granular que
      el otro). Explícitamente una aproximación, no un estándar de grading
      profesional — mismo criterio que ya se aplicó a `synthetic_wear.py`.
      **1,355 fotos reales importadas** (803 de `mtg-card-grading` + 552 de
      `card-grader`), pasadas por `card_preprocessing.normalizar_carta`
      antes de guardarse (son fotos de eBay con fondo real, no renders
      limpios) y sumadas a `condition_dataset/index.csv` junto a las 4,000
      sintéticas (total: 5,355 filas). Distribución real sesgada hacia NM
      (590/216/181/191/177 NM→DMG) — tiene sentido: vendedores fotografían
      más sus cartas en buen estado. Inspeccionado visualmente: un ejemplo
      DMG mostró un card-back genuinamente gastado (scratches, esquinas
      peladas reales) y un ejemplo NM (Nicol Bolas, God-Pharaoh) se veía
      impecable — la heurística y la localización funcionan razonablemente
      sobre este dataset variado.
- [x] Reentrenar con el dataset combinado (sintético + real) y comparar
      contra el baseline sintético-solo — hecho (8 ago), ver subsección
      abajo.
- [x] Optuna sobre este modelo también (`src/condition_classifier.py` ya
      estaba parametrizado para eso, mismo patrón que la sección 0) — hecho
      en ambos frameworks, ver tabla arriba (PyTorch +20.5 pts, TensorFlow
      +10.3 pts sobre sus respectivos baselines fijos).

**Reentrenado con dataset combinado (8 ago)**: `pytorch/12_condition_grader_combined.py`
(nuevo) reentrena PyTorch — framework ganador — usando los mejores
hiperparámetros de Optuna (arriba) pero sobre `condition_dataset/index.csv`
ya con las fotos reales mezcladas (de las 1,355 importadas, 1,184 quedaron
como "carta base" propia tras el split — cada foto real es su propia unidad,
sin variantes hermanas — más las 800 cartas sintéticas = 1,984 unidades,
4,279 train / 1,076 val, split por carta igual que siempre).

| Corrida | Validación | Accuracy | F1 (macro) |
|---|---|---|---|
| Optuna (sintético-solo) | 800 imágenes, 100% sintéticas | 0.9525 | 0.9523 |
| Combinado (sintético + real) | 1,076 imágenes, mezcla real+sintética | 0.9024 | 0.8985 |

**No es una comparación directa** — el segundo número es más bajo, pero
sobre un set de validación objetivamente más difícil (incluye fotos reales
con ruido de fotografía, no solo renders con desgaste sintético), así que
no se puede leer como "empeoró". Lo interesante está en el desglose por
grado: NM/LP/MP/DMG se mantienen todos ≥88% de F1, pero **HP tiene
precision de apenas 73.5%** (aunque su recall es el más alto de todos,
92.8%) — el modelo sobre-predice HP, probablemente porque los umbrales de
Roboflow (heurística de conteo de cajas, ver abajo) meten en HP fotos reales
con desgaste ambiguo que un sistema de grading profesional pondría en MP o
LP. Matriz de confusión y curva de entrenamiento en
`output/pytorch/condition_grader_combined/latest/`.

**Comparación cabeza a cabeza en fotos reales holdout (8 ago)**:
`pytorch/13_analizar_generalizacion_real.py` (nuevo) responde la pregunta
que quedó pendiente arriba — ¿generaliza mejor a fotos reales el modelo que
las vio en entrenamiento? Metodología: se evalúan ambos modelos (arquitectura
idéntica, freeze_ratio=0.5/head_units=448/dropout=0.35 — la única variable es
el dataset de entrenamiento) sobre las **266 fotos reales** que cayeron en el
split de validación de `12_condition_grader_combined.py` (mismo seed=42) —
holdout genuino para el modelo combinado (nunca las vio en train) y también
para el sintético-solo (nunca vio *ninguna* foto real, así que cualquiera le
sirve de test limpio).

| Modelo | Accuracy | F1 (macro) |
|---|---|---|
| Sintético-solo (Optuna, 95.25% en su propio val) | **0.3872** | 0.2446 |
| Combinado (sintético + real) | **0.7218** | 0.5892 |

Diferencia de **+33.5 puntos de accuracy**. El modelo sintético-solo —pese a
su 95.25% en su propio split— colapsa a fotos reales: la matriz de confusión
muestra que sobre-predice NM y DMG casi indiscriminadamente (ve "brillo de
funda" o "blur de cámara" como señal de desgaste, o los ignora del todo, sin
distinguir grados intermedios). El modelo combinado, con solo 800 fotos
reales de entrenamiento adicionales, generaliza sensiblemente mejor. **Esto
confirma con datos la hipótesis planteada arriba sobre Bastion of
Remembrance** (sección 0 y esta misma sección): el techo alto medido en
datos curados/sintéticos no predice el desempeño en fotos reales, y unas
pocas fotos reales durante el entrenamiento valen mucho más que agrandar el
dataset sintético. Conclusión práctica: **el modelo combinado
(`condition_grader_combined.pth`) es el que debería usarse en producción**,
no el de mayor accuracy nominal.

**Diagnóstico del label noise en HP**: la misma corrida re-lee los COCO JSON
originales de Roboflow para recuperar el conteo de cajas de daño por imagen
(no se guarda en `index.csv`) y lo cruza con los 64 errores del modelo
combinado que involucran HP. **62% de esos errores caen a ≤2 cajas de un
umbral de cuartil** — el tipo de caso donde una sola caja de anotación de
diferencia cambia el grado asignado, consistente con que buena parte del
problema es ruido de la heurística de etiquetado, no del modelo. El
desglose por dataset de origen lo confirma: **51/64 errores vienen de
`cross_tcg_v2`** (umbrales finos: 4/7/11 cajas) contra solo 13/64 de
`mtg_v6` (umbrales gruesos: 12/18/33) — el dataset con fronteras más
angostas entre grados es, como se esperaría, el que más ruido de etiqueta
mete cerca de HP. Detalle completo (los 64 casos, con conteo y distancia al
umbral) en
`output/pytorch/condition_grader_combined/analisis_generalizacion_real.json`.

**Para reproducir la importación de datos reales** (necesita una cuenta
gratis de Roboflow — [roboflow.com](https://roboflow.com) → Settings →
Roboflow API → Private API Key):

```bash
cd ml/data-prep
echo "ROBOFLOW_API_KEY=tu_key_acá" > .env      # gitignored, no se versiona
pip install roboflow python-dotenv

python -c "
import os
from dotenv import load_dotenv; load_dotenv()
from roboflow import Roboflow
rf = Roboflow(api_key=os.environ['ROBOFLOW_API_KEY'])
rf.workspace('stall-ysun2').project('mtg-card-grading').version(6) \
  .download('coco', location='data/roboflow_raw/mtg_v6')
rf.workspace('group-6-major-project').project('card-grader').version(2) \
  .download('coco', location='data/roboflow_raw/cross_tcg_v2')
"

python import_roboflow_condition_data.py
```
