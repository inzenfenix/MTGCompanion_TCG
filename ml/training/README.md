# MTG Card Scanner — Certamen 1

Reconocimiento de cartas de Magic: The Gathering a partir de una foto, comparando
dos frameworks de deep learning sobre el mismo dataset:

- **pytorch/** — EfficientNet_b0 (Tomás Solano)
- **tensorFlow/** — MobileNetV2 (Joaquín Rodriguez)

Ambos pipelines comparten el mismo dataset (catálogo + imágenes de Scryfall),
generado una sola vez por los scripts en la raíz de esta carpeta.

## Estructura

```
ml/training/
├── 01_scraper.py              # descarga y filtra el catálogo (compartido)
├── 02_downloader.py           # descarga las imágenes del catálogo (compartido)
├── 04_evaluate.py             # punto de entrada único: evalúa pytorch, tensorflow o ambos
├── data/                      # dataset compartido — se genera, no se versiona
│   ├── raw_cards.json         # cache del dump bulk de Scryfall
│   ├── cards.json             # dataset filtrado (~29 k cartas)
│   ├── images/                # {card_id}.jpg  (~3.6 GB)
│   └── images_negatives/      # cartas no-MTG para el clasificador binario
│       ├── pokemon/           # imágenes Pokémon TCG descargadas de pokemontcg.io
│       └── pokemon_meta.json  # metadatos en caché
├── output/                    # historial de métricas — se versiona (ver sección 5)
│   ├── pytorch/{timestamp}/   # una carpeta por corrida de evaluación
│   └── tensorflow/{timestamp}/
├── pytorch/                   # pipeline PyTorch (EfficientNet_b0)
│   ├── 03_pt_embedder.py      # extrae embeddings del dataset
│   ├── 04_evaluate.py         # implementación de evaluación (invocada por ../04_evaluate.py)
│   ├── 05_visualize.py        # t-SNE y EDA del dataset
│   ├── 06_finetune.py         # fine-tuning contrastivo SimCLR (opcional)
│   ├── 07_binary_classifier.py# clasificador MTG / no-MTG (EfficientNet_b0)
│   └── scanner.py             # demo CLI con pipeline de dos etapas
├── tensorFlow/                # pipeline TensorFlow (MobileNetV2)
│   ├── 03_build_embeddings.py # construye el índice de embeddings
│   ├── 04_evaluate.py         # implementación de evaluación (invocada por ../04_evaluate.py)
│   ├── 05_visualize.py        # t-SNE y EDA del dataset
│   ├── 07_binary_classifier.py# clasificador MTG / no-MTG (MobileNetV2)
│   └── scanner.py             # demo CLI
└── Testing/                   # comparación cara a cara de ambos scanners
    ├── compare_scanners.py    # corre ambos scanners sobre la(s) misma(s) imagen(es)
    ├── download_random_card.py# descarga una carta aleatoria de Scryfall y la compara
    └── testing_photos/        # imágenes usadas para las comparaciones
```

## 1. Generar el dataset compartido

Este paso se hace **una sola vez** y sirve para ambos pipelines.

```bash
cd certamen_1

python 01_scraper.py                     # ~30 000 cartas únicas de Scryfall
python 01_scraper.py --max-cards 5000    # versión reducida para pruebas

python 02_downloader.py                  # descarga imágenes (reanudable, ~3.6 GB)
python 02_downloader.py --workers 8 --delay 0.05
```

Al terminar, `data/cards.json` y `data/images/*.jpg` quedan disponibles para
ambos pipelines.

## 2. Pipeline PyTorch (EfficientNet_b0)

```bash
cd pytorch
python -m venv .venv
source .venv/bin/activate          # Windows: .venv/Scripts/activate
pip install -r requirements.txt
```

```bash
python 03_pt_embedder.py           # embeddings de ~29 k cartas (~5 min en GPU)
python 05_visualize.py             # t-SNE coloreado + EDA del dataset
python 06_finetune.py              # fine-tuning SimCLR (opcional)
python 07_binary_classifier.py     # clasificador binario MTG / no-MTG
```

Para evaluar el retrieval, usar `04_evaluate.py` desde la raíz de `ml/training/`
(ver sección 5) en vez de correrlo directamente desde acá.

**Usar el scanner:**

```bash
# Identificar una carta (detecta MTG/no-MTG automáticamente si existe el modelo)
python scanner.py test_photos/mi_carta.jpg

# Cantidad de candidatos a mostrar y umbral de similitud para el veredicto Magic/No-Magic
python scanner.py test_photos/mi_carta.jpg --top 10 --threshold 0.8

# Con Test-Time Augmentation (más estable con fotos movidas o en ángulo)
python scanner.py test_photos/mi_carta.jpg --top 10 --tta 7

# Usar embeddings del modelo fine-tuneado
python scanner.py test_photos/mi_carta.jpg --finetuned

# Saltar el clasificador binario y forzar búsqueda directa
python scanner.py test_photos/mi_carta.jpg --skip-detect
```

Además del clasificador binario (etapa 1), `scanner.py` decide un veredicto Magic /
No-Magic por similitud (etapa 2): si la similitud coseno del top-1 supera
`--threshold` (default `0.75`, el umbral óptimo medido en `results/metrics_pt.json`),
se marca la imagen como `MAGIC`. Esto replica el criterio que usa el scanner de
TensorFlow y permite comparar ambos frameworks con el mismo criterio (ver
`Testing/` más abajo).

Artefactos locales: `pytorch/data/`, `pytorch/models/`. Las métricas de evaluación
quedan en `output/pytorch/` (raíz de `ml/training/`), no acá.

## 3. Pipeline TensorFlow (MobileNetV2)

```bash
cd tensorFlow
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

```bash
python 03_build_embeddings.py                  # construye el índice de embeddings (~5000 cartas, ~7-10 min en CPU)
python 03_build_embeddings.py --force          # reconstruye aunque ya exista (necesario tras regenerar el dataset)

python 05_visualize.py                         # t-SNE coloreado + EDA del dataset

python 07_binary_classifier.py                 # clasificador binario MTG / no-MTG
python 07_binary_classifier.py --skip-download # reutiliza Pokémon ya descargados
```

Para evaluar el retrieval, usar `04_evaluate.py` desde la raíz de `ml/training/`
(ver sección 5) en vez de correrlo directamente desde acá.

**Usar el scanner:**

```bash
python scanner.py test_photos/mi_carta.jpg --top-k 5 --threshold 0.75
```

El índice de embeddings (`data/indexes/magic_embeddings.pkl`) debe existir antes
de usar `scanner.py`, `04_evaluate.py` o `05_visualize.py` — se construye con
`03_build_embeddings.py`. Si `data/cards.json` / `data/images/` se regeneran
(más o menos cartas que antes), hay que reconstruir el índice con `--force`,
o el sistema comparará contra cartas desactualizadas.

Artefactos locales: `tensorFlow/data/indexes/magic_embeddings.pkl`,
`tensorFlow/models/`. Las métricas de evaluación quedan en `output/tensorflow/`
(raíz de `ml/training/`), no acá.

## 4. Clasificador binario MTG / No-MTG

Ambos pipelines incluyen un clasificador que determina si una imagen es una carta
MTG **antes** de intentar identificarla. El script descarga automáticamente imágenes
de cartas Pokémon como ejemplos negativos y entrena un modelo balanceado.

### PyTorch — EfficientNet_b0

```bash
cd pytorch

# Primera ejecución: descarga ~3 000 Pokémon + entrena
python 07_binary_classifier.py

# Reruns (imágenes ya descargadas):
python 07_binary_classifier.py --skip-download

# Ajustar dataset o épocas:
python 07_binary_classifier.py --n 2000 --epochs 20
```

Modelo guardado en `pytorch/models/mtg_detector.pth`. El `scanner.py` lo carga
automáticamente; si no existe, avisa y continúa sin el filtro.

### TensorFlow — MobileNetV2

```bash
cd tensorFlow

# Reutiliza los Pokémon descargados por el pipeline PyTorch (directorio compartido)
python 07_binary_classifier.py --skip-download

# Si se corre antes que el pipeline PyTorch (descarga desde cero):
python 07_binary_classifier.py

# Ajustar dataset o épocas:
python 07_binary_classifier.py --n 2000 --epochs 20
```

Mismo pipeline que en PyTorch (descarga negativos → dataset balanceado → fine-tuning
parcial → evaluación), adaptado a Keras: MobileNetV2 con las primeras capas
congeladas, cabeza binaria `Dense(256) → Dropout → Dense(1, sigmoid)`, y
augmentación con capas `tf.keras.layers.Random*` sobre un pipeline `tf.data`.

Modelo guardado en `tensorFlow/models/mtg_detector.keras`.

### Salidas generadas (ambos frameworks)

| Archivo | Descripción |
|---|---|
| `results/confusion_matrix_binary.png` | TP / TN / FP / FN del clasificador |
| `results/roc_auc.png` | Curva ROC — AUC del clasificador MTG/no-MTG |
| `results/metrics_binary_bar.png` | Accuracy, Precision, Recall, F1, ROC-AUC |
| `results/loss_binary.png` | Curva de pérdida train / val por época |
| `results/metrics_binary.json` | Métricas numéricas en JSON |

## 5. Métricas de evaluación

`04_evaluate.py`, en la raíz de `ml/training/`, es el punto de entrada único para
evaluar el retrieval de cualquiera de los dos frameworks (o ambos). Decide qué
framework(s) correr, se asegura de que el venv correspondiente exista (lo crea e
instala su `requirements.txt` si falta) y corre la implementación de evaluación
de cada uno dentro de su propio entorno — no hace falta activar ningún venv a mano.

```bash
cd certamen_1

python 04_evaluate.py                    # evalúa ambos frameworks
python 04_evaluate.py --model pytorch     # solo PyTorch
python 04_evaluate.py --model tensorflow  # solo TensorFlow
```

Cada corrida queda en `output/{pytorch,tensorflow}/{timestamp}/`, sin sobreescribir
corridas anteriores — así se puede ver cómo evolucionan las métricas a medida que
cambian los modelos. `output/{framework}/latest` siempre apunta a la corrida más
reciente. A diferencia de `data/` y de los `.venv/`, **`output/` sí se versiona**:
es el historial de métricas del proyecto.

### Cómo probarlo

Requisitos antes de correrlo (por cada framework que quieras evaluar): dataset
compartido generado (paso 1) y el índice de embeddings propio construido
(`pytorch/03_pt_embedder.py` o `tensorFlow/03_build_embeddings.py`). Si falta el
venv de un framework, `04_evaluate.py` lo crea solo — no hace falta preparar nada
más a mano.

```bash
cd certamen_1
python 04_evaluate.py --model pytorch
```

Salida esperada (resumida):

```
══════════════════════════════════════════════════════════════════
  Evaluando PyTorch (EfficientNet_b0)
══════════════════════════════════════════════════════════════════
Device    : cuda:0
Galería   : 5,000 cartas
Consultas : 1,000 cartas (imágenes augmentadas)
Evaluando 1,000 queries...
   100/1000  Top-1: 0.410  Top-5: 0.530  MRR: 0.448
   ...
  ── Retrieval ─────────────────────────────────────
  Top-1 Accuracy   : 0.4090
  ...
Generando gráficos...
  → .../output/pytorch/2026-07-19_190210/metrics_pt.png
  ...

  ✓ PyTorch (EfficientNet_b0) evaluado en 75.0s.
    Resultados: .../output/pytorch/2026-07-19_190210
    Último enlace: .../output/pytorch/latest

══════════════════════════════════════════════════════════════════
  Resumen
══════════════════════════════════════════════════════════════════
  PyTorch (EfficientNet_b0)    OK
```

Para confirmar que funcionó: `ls output/pytorch/latest/` debe mostrar
`metrics_pt.json` + los `.png` de la tabla más abajo, y el exit code del
comando debe ser `0` (si algún framework falla, `04_evaluate.py` termina con
exit code `1` y lo marca `ERROR` en el resumen).

**Evaluar ambos modelos en una sola corrida** (por defecto, sin pasar `--model`):

```bash
python 04_evaluate.py
```

Esto corre PyTorch y después TensorFlow, cada uno en su propio venv, y al final
imprime un resumen con el estado (`OK` / `ERROR`) de cada uno.

### Retrieval (PyTorch)

Evalúa el sistema de similitud: toma el 20 % de cartas, les aplica augmentaciones
que simulan una foto real (perspectiva, brillo, blur, rotación) y busca en la
galería completa.

**Salidas generadas en `output/pytorch/{timestamp}/`:**

| Archivo | Descripción |
|---|---|
| `metrics_pt.json` | Todas las métricas numéricas |
| `metrics_pt.png` | Barras Top-1 / Top-5 / MRR |
| `roc_retrieval_pt.png` | Curva ROC del retrieval (score = similitud coseno top-1) |
| `confusion_rareza_pt.png` | Confusion matrix 4×4 agrupada por rareza de carta |
| `metricas_clasificacion_pt.png` | Accuracy, Precision, Recall, F1, ROC-AUC al umbral óptimo |
| `eval_examples.png` | Grid de ejemplos correctos e incorrectos |

**Métricas reportadas:**

| Métrica | Descripción |
|---|---|
| Top-1 Accuracy | La carta correcta es el primer resultado |
| Top-5 Accuracy | La carta correcta está entre los 5 primeros |
| MRR | Mean Reciprocal Rank |
| Accuracy | Fracción de queries con top-1 correcto (= Top-1) |
| Precision | TP / (TP+FP) al umbral óptimo de similitud |
| Recall | TP / (TP+FN) al umbral óptimo de similitud |
| F1-Score | Media armónica de Precision y Recall |
| ROC-AUC | Qué tan bien predice la similitud coseno si la identificación es correcta |

> El umbral óptimo se calcula automáticamente maximizando el estadístico de Youden
> (TPR − FPR) sobre la curva ROC.

### Retrieval (TensorFlow)

Mismo protocolo que en PyTorch: galería = todos los embeddings del índice, queries
= 20 % de las cartas con augmentaciones que simulan una foto real (perspectiva,
brillo, contraste, color, rotación, crop, blur — implementado solo con PIL, sin
`torchvision`), re-extraídas con MobileNetV2 y comparadas por similitud coseno.

```bash
cd certamen_1 && python 04_evaluate.py --model tensorflow
cd tensorFlow && python 05_visualize.py
```

**Salidas generadas en `output/tensorflow/{timestamp}/`:**

| Archivo | Descripción |
|---|---|
| `metrics_tf.json` | Todas las métricas numéricas (retrieval + clasificación) |
| `metrics_tf.png` | Barras Top-1 / Top-5 / MRR |
| `eval_examples_tf.png` | Grid de ejemplos de recuperación correctos e incorrectos |
| `roc_retrieval_tf.png` | Curva ROC del retrieval (score = similitud coseno top-1) |
| `confusion_rareza_tf.png` | Confusion matrix agrupada por rareza de carta |
| `metricas_clasificacion_tf.png` | Accuracy, Precision, Recall, F1, ROC-AUC al umbral óptimo |
| `tsne_tf.png` | t-SNE de embeddings coloreado por color de maná |
| `rarity_tsne_tf.png` | t-SNE de embeddings coloreado por rareza |
| `stats_dataset.png` | EDA del dataset: rareza, color, CMC, año de lanzamiento |

Las métricas reportadas son las mismas que en PyTorch (ver tabla arriba). La
única diferencia es cómo se elige el umbral óptimo: en TensorFlow se maximiza
directamente el F1-score sobre la curva precision-recall, en vez del estadístico
de Youden sobre la curva ROC.

## 6. Comparación entre frameworks (Testing/)

Además de las métricas de evaluación por separado, `Testing/` corre ambos scanners
sobre las mismas imágenes y muestra lado a lado qué carta identificó cada uno, con
qué similitud y si la considera Magic o no. Útil para ver en la práctica cómo
reacciona cada modelo frente a la misma foto (fotos reales, ángulos, iluminación).

Requiere que `pytorch/.venv` y `tensorFlow/.venv` ya existan con sus dependencias
instaladas, y que ambos índices de embeddings estén construidos (pasos 2 y 3).

```bash
cd Testing
python -m venv .venv && source .venv/bin/activate   # solo necesita `requests`
pip install -r requirements.txt
```

**Comparar imágenes existentes:**

```bash
# Compara todas las imágenes en testing_photos/
python compare_scanners.py

# Compara una imagen puntual
python compare_scanners.py testing_photos/mi_carta.jpg

# Cantidad de candidatos y umbral de similitud (se pasan a ambos scanners)
python compare_scanners.py --top 10 --threshold 0.8

# Omite el clasificador binario de PyTorch (deja solo el umbral de similitud, igual que TensorFlow)
python compare_scanners.py --skip-detect
```

**Descargar una carta aleatoria y compararla:**

```bash
# Pide una carta al azar a Scryfall, la guarda en testing_photos/ y compara ambos scanners
python download_random_card.py

# Calidad de la imagen descargada (small / normal / large / png)
python download_random_card.py --quality large

# Solo descargar, sin comparar
python download_random_card.py --no-compare
```

Cada scanner corre en su propio venv (`pytorch/.venv`, `tensorFlow/.venv`) como
subproceso, así que `Testing/` no necesita tener `torch` ni `tensorflow` instalados.
La salida muestra, por imagen: framework, veredicto (`MAGIC` / `NO_MAGIC`), carta
identificada, similitud y tiempo de inferencia — y, para PyTorch, la probabilidad
del clasificador binario si el modelo está entrenado.

## Notas

- `data/` compartido y `pytorch/data/` / `tensorFlow/data/` están en `.gitignore`
  — no se versionan por tamaño.
- `02_downloader.py` es idempotente: omite imágenes ya descargadas.
- `07_binary_classifier.py` es idempotente: las imágenes Pokémon en caché no se
  re-descargan. El caché vive en `data/images_negatives/` (compartido entre ambos
  frameworks — solo se descarga una vez).
- Los negativos vienen de `pokemontcg.io` (API pública, sin clave).
- El `scanner.py` de PyTorch tiene dos etapas: primero clasifica MTG/no-MTG con
  el clasificador binario, luego recupera por similitud y decide el veredicto
  final con `--threshold`. Usar `--skip-detect` para omitir la etapa 1.
- `Testing/.venv` es independiente de `pytorch/.venv` y `tensorFlow/.venv` — solo
  necesita `requests` para orquestar ambos scanners como subprocesos.
- El `04_evaluate.py` de la raíz crea `pytorch/.venv` y/o `tensorFlow/.venv` la
  primera vez que hacen falta (instalando su `requirements.txt`), por si se corre
  antes de haber seguido los pasos 2/3 manualmente.
- Si el Python por defecto de la máquina es demasiado nuevo y no tiene wheel de
  TensorFlow disponible (pasa con releases de Python muy recientes), `04_evaluate.py`
  busca automáticamente un Python 3.9–3.12 instalado vía `pyenv` y reintenta el venv
  de `tensorFlow/` con ese. Si no hay ninguno instalado, avisa cómo instalar uno
  (`pyenv install 3.12.9`).
- `output/` se versiona a propósito (no está en `.gitignore`): es el historial de
  métricas de cada framework a medida que evolucionan los modelos.
