# MTG Card Scanner — Certamen 2

> 🚧 En construcción. Hecho hasta ahora: Optuna sobre el detector MTG/no-MTG
> (sección 0), el dataset compartido re-scrapeado con estilo/texto/precio
> (sección 5) y el baseline tabular de Stage 3 (sección 5.1). El resto de
> este documento es el plan acordado para el flujo de tres modelos que
> alimenta la app Ionic — ver [Proyecto/examen/README.md](../examen/README.md).

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
      `Proyecto/certamen_1/output/tensorflow/optuna/2026-07-21_104919/`
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
      pesos. Corrida real (n=3000, 20 trials, 6 épocas/trial, 15 finales) en
      curso — resultados en `Proyecto/certamen_1/output/pytorch/optuna/latest/`
      cuando termine.

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
- **TensorFlow**: se migra `MobileNetV2` → **`MobileNetV3`** (Small o Large a
  definir según tiempo de entrenamiento disponible) para las tres etapas.
  Motivo: mejor trade-off precio/latencia que V2 y pensado desde el diseño
  para inferencia móvil — encaja directo con el objetivo final (correr en la
  app Ionic vía ONNX).
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

### Stage 1 — Detector MTG/no-MTG (existente, en migración)

Ya construido y evaluado en Certamen 1. Pendiente para dejarlo alineado con
las otras dos etapas:

- [ ] Migrar la versión TensorFlow de `MobileNetV2` a `MobileNetV3` (en curso).
- [x] Optuna sobre la versión PyTorch — ver sección 0.
- [x] Exportar PyTorch a ONNX: `pytorch/09_export_onnx.py`
      (`torch.onnx.export` + verificación de paridad numérica contra
      `onnxruntime`, diff máxima ~0 en la corrida de prueba). Falta el lado
      TensorFlow (`tf2onnx`, mismo patrón) — pendiente hasta que termine la
      migración a MobileNetV3.

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
[plan del examen](../examen/README.md)) — no solo "qué carta es", sino
"cuánto vale hoy".

Entrada: metadata de la carta ya confirmada (rareza, set, `cmc`, colores,
`type_line`, antigüedad/`released_at`, `set_type`) + el embedding visual del
backbone compartido como feature adicional.
Salida: precio estimado en USD (regresión).

Dataset: `prices` (`usd`, `usd_foil`, `eur`, `tix`) recién se agregó a
`CAMPOS` en `01_scraper.py` (mismo bulk data que ya usa `01_scraper.py`, solo
faltaba pedirlo). Un snapshot actual alcanza para un regresor de referencia —
no hace falta series históricas de precio.

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

Reemplaza el enfoque anterior del [plan del examen](../examen/README.md), que
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
  [certamen_1/README.md](../certamen_1/README.md)).
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
cd Proyecto/certamen_2
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

### 5.2 Baseline de Stage 2 — `text_validator_baseline.py`

Mismo espíritu que 5.1 pero para el validador de texto: un baseline sin
modelo propio entrenado (**OpenCV + OCR + similitud de strings**), antes de
construir las dos versiones "de verdad" por framework.

```bash
cd Proyecto/certamen_2
python text_validator_baseline.py                # 800 cartas de muestra
python text_validator_baseline.py --n 200          # muestra chica, iterar rápido
```

Pipeline: recorte fijo de la caja de texto (proporciones del frame moderno,
sin corrección de perspectiva real todavía) → OCR con `pytesseract` → similitud
(`difflib`) contra `name` + `oracle_text` de la carta candidata. Descarga su
propia sub-muestra en calidad "large" (`certamen_2/data/ocr_images/`,
gitignored) — las imágenes "small" del dataset compartido (146×204px) son
ilegibles para OCR.

**Resultado de la corrida real (800 cartas, 1600 pares positivo/negativo):**

| Métrica | Valor |
|---|---|
| ROC-AUC | 0.833 |
| Accuracy (umbral óptimo) | 0.840 |
| Score promedio — positivo | 0.517 |
| Score promedio — negativo | 0.168 |

Un baseline sin modelo propio entrenado separa positivos de negativos con
AUC 0.83 — señal fuerte de que el enfoque (OCR + comparación de texto) es
viable antes de invertir en un clasificador entrenado. `ejemplos_ocr.png` en
`output/text_validator_baseline/latest/` muestra que el OCR lee texto real y
legible (ej. "If a Giant source you control would deal damage to a
permane…" para *Calamity Bearer*, calzando exacto con su `oracle_text`).

### 5.3 Demo del flujo completo — `full_pipeline_demo.py`

Encadena Stage 1 (`pytorch/scanner.py`, subproceso) → Stage 2 → Stage 3 sobre
una sola foto, con lo que existe hoy (baselines, no los modelos "de verdad"):

```bash
cd Proyecto/certamen_2
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
- [ ] Migrar TensorFlow de MobileNetV2 a MobileNetV3 en las tres etapas (en curso).
- [ ] Reconstruir `pytorch/data/index_pt.json` (embeddings) contra el dataset
      completo — sigue en su subconjunto original de 5,000 cartas, causa
      identificaciones erróneas evitables (encontrado corriendo
      `full_pipeline_demo.py`, ver sección 5.3).
- [ ] Script de entrenamiento Stage 2 (nombre tentativo: `08_text_validator.py`,
      por framework) — versión "de verdad", no el baseline.
- [ ] Stage 3 "de verdad" por framework (nombre tentativo: `09_price_estimator.py`),
      sumando el embedding visual al baseline tabular de la sección 5.1.
- [ ] Aplicar Optuna a Stage 2 y Stage 3 una vez tengan un baseline entrenando
      (mismo patrón que la sección 0).
- [ ] Exportar TensorFlow a ONNX (`tf2onnx`) y armar el registro
      `best_model.json` por etapa (sección 2).
- [ ] Métricas a reportar: ROC-AUC del validador de texto; MAE / RMSE / R² del
      estimador de precio sobre un hold-out.
- [ ] Condición de la carta: hoy es un input declarado por el usuario +
      multiplicador de mercado (sección 7) — evaluar si vale la pena un
      clasificador visual real más adelante, y de qué fuente saldrían fotos
      etiquetadas por condición sin repetir el problema de derechos de eBay.

## 7. Por qué este enfoque

Se descartaron dos alternativas más simples (ver discusión en el chat del
proyecto):
- **Detector de daño/condición de la carta** — encaja con un ángulo comercial
  de tasación, pero requiere un dataset etiquetado a mano desde cero (mint /
  played / damaged) que no tenemos. `prices.usd` de Scryfall es un precio de
  referencia esencialmente near-mint (sus imágenes son scans oficiales
  pristinos, cero variación de condición) — el sistema hoy no tiene ninguna
  señal de condición en ningún lado. **Stopgap implementado en
  `full_pipeline_demo.py`** (7 ago): condición como input declarado por quien
  escanea (`--condition NM/LP/MP/HP/DMG`), ajustada al precio predicho con
  multiplicadores estándar de la industria (`CONDITION_MULTIPLIERS` en
  `price_estimator_baseline.py`) — no es una señal aprendida, es una regla.
  Un clasificador visual de condición de verdad seguiría necesitando fotos
  etiquetadas por condición; la fuente más plausible (listings de eBay, con
  condición autodeclarada por el vendedor) tiene el mismo problema de
  derechos/ToS que ya se descartó para diversidad de estilo (sección 5) —
  usar la API oficial de eBay en vez de scrapear HTML sería el camino menos
  malo, pero la pregunta de derechos de uso comercial no desaparece solo por
  usar la API, y las etiquetas de condición autodeclaradas por vendedores son
  ruidosas (no es grading profesional). No se persiguió esta vía todavía.
- **Solo estimador de precio** (sin el validador de texto) — es un flujo de un
  solo modelo nuevo, no dos, y no ataca el problema real de identificación
  ambigua que puede tener el sistema de Certamen 1.

Combinar validador de texto + estimador de precio da dos modelos genuinamente
encadenados (la salida de uno es prerequisito del otro) resolviendo un problema
concreto. Duplicar cada etapa en ambos frameworks y compararlos por métrica
(sección 2), en vez de comprometerse a uno solo desde el inicio, deja elegir
el mejor de cada etapa con datos en vez de a priori — y ONNX (sección 3)
hace que esa elección no ate la app final a un solo framework.
