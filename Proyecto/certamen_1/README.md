# MTG Card Scanner — Certamen 1

Reconocimiento de cartas de Magic: The Gathering a partir de una foto, comparando
dos frameworks de deep learning sobre el mismo dataset:

- **pytorch/** — EfficientNet_b0 (Tomás Solano)
- **tensorFlow/** — MobileNetV2 (Joaquín Rodriguez)

Ambos pipelines comparten el mismo dataset (catálogo + imágenes de Scryfall),
generado una sola vez por los scripts en la raíz de esta carpeta.

## Estructura

```
certamen_1/
├── 01_scraper.py              # descarga y filtra el catálogo (compartido)
├── 02_downloader.py           # descarga las imágenes del catálogo (compartido)
├── data/                      # dataset compartido — se genera, no se versiona
│   ├── raw_cards.json         # cache del dump bulk de Scryfall
│   ├── cards.json             # dataset filtrado (~29 k cartas)
│   ├── images/                # {card_id}.jpg  (~3.6 GB)
│   └── images_negatives/      # cartas no-MTG para el clasificador binario
│       ├── pokemon/           # imágenes Pokémon TCG descargadas de pokemontcg.io
│       └── pokemon_meta.json  # metadatos en caché
├── pytorch/                   # pipeline PyTorch (EfficientNet_b0)
│   ├── 03_pt_embedder.py      # extrae embeddings del dataset
│   ├── 04_evaluate.py         # evalúa retrieval + métricas de clasificación
│   ├── 05_visualize.py        # t-SNE y EDA del dataset
│   ├── 06_finetune.py         # fine-tuning contrastivo SimCLR (opcional)
│   ├── 07_binary_classifier.py# clasificador MTG / no-MTG (EfficientNet_b0)
│   └── scanner.py             # demo CLI con pipeline de dos etapas
└── tensorFlow/                # pipeline TensorFlow (MobileNetV2)
    ├── 03_build_embeddings.py # construye el índice de embeddings
    ├── 04_evaluate.py         # evalúa una imagen individual
    ├── 05_visualize.py        # visualización de predicciones
    ├── 07_binary_classifier.py# clasificador MTG / no-MTG (MobileNetV2)
    └── scanner.py             # demo CLI
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
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

```bash
python 03_pt_embedder.py           # embeddings de ~29 k cartas (~5 min en GPU)
python 04_evaluate.py              # retrieval + métricas de clasificación completas
python 05_visualize.py             # t-SNE coloreado + EDA del dataset
python 06_finetune.py              # fine-tuning SimCLR (opcional)
python 07_binary_classifier.py     # clasificador binario MTG / no-MTG
```

**Usar el scanner:**

```bash
# Identificar una carta (detecta MTG/no-MTG automáticamente si existe el modelo)
python scanner.py test_photos/mi_carta.jpg

# Con Test-Time Augmentation (más estable con fotos movidas o en ángulo)
python scanner.py test_photos/mi_carta.jpg --top 10 --tta 7

# Usar embeddings del modelo fine-tuneado
python scanner.py test_photos/mi_carta.jpg --finetuned

# Saltar el clasificador binario y forzar búsqueda directa
python scanner.py test_photos/mi_carta.jpg --skip-detect
```

Artefactos locales: `pytorch/data/`, `pytorch/results/`, `pytorch/models/`.

## 3. Pipeline TensorFlow (MobileNetV2)

```bash
cd tensorFlow
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

```bash
python 03_build_embeddings.py                  # construye el índice de embeddings
python 03_build_embeddings.py --force          # reconstruye aunque ya exista

python 07_binary_classifier.py                 # clasificador binario MTG / no-MTG
python 07_binary_classifier.py --skip-download # reutiliza Pokémon ya descargados

python 05_visualize.py --preview
python 05_visualize.py --image test_photos/mi_carta.jpg --output data/prediccion.png

python scanner.py test_photos/mi_carta.jpg --top-k 5 --threshold 0.75
```

Artefacto local: `tensorFlow/data/indexes/magic_embeddings.pkl`, `tensorFlow/models/`.

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
```

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

### Retrieval (04_evaluate.py — PyTorch)

Evalúa el sistema de similitud: toma el 20 % de cartas, les aplica augmentaciones
que simulan una foto real (perspectiva, brillo, blur, rotación) y busca en la
galería completa.

```bash
cd pytorch
python 04_evaluate.py
```

**Salidas generadas en `pytorch/results/`:**

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

## Notas

- `data/` compartido y `pytorch/data/` / `tensorFlow/data/` están en `.gitignore`
  — no se versionan por tamaño.
- `02_downloader.py` es idempotente: omite imágenes ya descargadas.
- `07_binary_classifier.py` es idempotente: las imágenes Pokémon en caché no se
  re-descargan. El caché vive en `data/images_negatives/` (compartido entre ambos
  frameworks — solo se descarga una vez).
- Los negativos vienen de `pokemontcg.io` (API pública, sin clave).
- El `scanner.py` de PyTorch tiene dos etapas: primero clasifica MTG/no-MTG,
  luego recupera por similitud. Usar `--skip-detect` para omitir la etapa 1.
