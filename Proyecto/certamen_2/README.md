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
      pesos. Corrida real completada (n=3000, 20 trials — 4 podados por el
      pruner, 15 épocas finales) — resultados en
      `Proyecto/certamen_1/output/pytorch/optuna/latest/`. Ganador: trial 0
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

Pipeline: `card_preprocessing.py` (localizar carta + corregir perspectiva +
normalizar contraste — ver sección 8) → recorte fijo de la caja de texto
dentro de la carta ya encuadrada → OCR con `pytesseract` → similitud
(`difflib`) contra `name` + `oracle_text` de la carta candidata. Descarga su
propia sub-muestra en calidad "large" (`certamen_2/data/ocr_images/`,
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
- [x] `card_preprocessing.py`: localizar carta + corregir perspectiva +
      normalizar contraste, compartido entre Stage 2 y Stage 4 — ver sección 8.
- [x] Condición de la carta: stopgap por regla (`--condition` + multiplicador)
      implementado — ver sección 7.
- [x] Stage 4 — clasificador de condición, ambos frameworks entrenados y
      evaluados (PyTorch 0.7475 acc, TensorFlow 0.6550 acc) — ver sección 9.
      Datasets públicos reales (Roboflow) todavía sin verificar/descargar,
      hoy corre 100% sobre el bootstrap sintético.

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
Stage 1); TensorFlow usa **`MobileNetV3Small`** directamente — Stage 4 es
código nuevo sin atar a la migración de Stage 1 (que sigue en MobileNetV2,
ver sección 1), así que no tenía sentido construirlo sobre V2 para migrarlo
después. Cabeza de clasificación de 5 salidas (softmax) en vez de la cabeza
binaria de Stage 1 — `pytorch/src/condition_classifier.py` y
`tensorFlow/src/condition_classifier.py`, mismo patrón que
`src/binary_classifier.py` en ambos frameworks (freeze_ratio/head_units/
dropout parametrizados, listo para Optuna después).

**Entrenado y evaluado (7 ago), resultado real:**

| Framework | Backbone | Accuracy | F1 (macro) |
|---|---|---|---|
| PyTorch | EfficientNet_b0 | **0.7475** | 0.7442 |
| TensorFlow | MobileNetV3Small | 0.6550 | 0.6603 |

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
- [ ] Verificar licencias de los datasets de Roboflow antes de descargarlos
      — complemento real de volumen sobre el bootstrap sintético, no hecho
      todavía.
- [ ] Conectar la salida a Stage 3 (`price_estimator_baseline.py`) como
      feature adicional, sin sacar el input manual (dejarlo como override).
- [ ] Optuna sobre este modelo también (`src/condition_classifier.py` ya está
      parametrizado para eso, mismo patrón que la sección 0).
