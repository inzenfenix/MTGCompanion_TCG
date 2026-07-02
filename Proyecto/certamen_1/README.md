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
├── 01_scraper.py              # descarga y filtra el catálogo de cartas (compartido)
├── 02_downloader.py           # descarga las imágenes del catálogo (compartido)
├── data/                      # dataset compartido — se genera, no se versiona
│   ├── raw_cards.json         # cache del dump bulk de Scryfall
│   ├── cards.json             # dataset filtrado (id, name, set, rarity, colors, image_url...)
│   ├── images/                # {card_id}.jpg  (~3.6 GB, ~29 k cartas MTG)
│   └── images_negatives/      # cartas no-MTG (Pokémon), generado por 07_binary_classifier.py
│       ├── pokemon/           # {id}.jpg  (~3 k imágenes Pokémon TCG)
│       └── pokemon_meta.json  # metadatos de la API pokemontcg.io
├── pytorch/                   # pipeline PyTorch (EfficientNet_b0)
└── tensorFlow/                # pipeline TensorFlow (MobileNetV2)
```

## 1. Generar el dataset compartido

Este paso se hace **una sola vez** y sirve para ambos pipelines. No requiere
ningún venv en particular: solo `requests` y `tqdm` (ya incluidos en los
`requirements.txt` de pytorch y tensorFlow).

```bash
cd certamen_1

python 01_scraper.py                     # cap por defecto: 5000 cartas, calidad "small"
python 01_scraper.py --max-cards 0       # sin cap (~30,000 cartas únicas)
python 01_scraper.py --max-cards 500 --quality normal

python 02_downloader.py                  # descarga las imágenes faltantes (reanudable)
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
python 03_pt_embedder.py           # extrae embeddings (~29 k cartas, ~5 min en GPU)
python 04_evaluate.py              # Top-1, Top-5, MRR con augmentaciones que simulan fotos
python 05_visualize.py             # t-SNE coloreado + EDA del dataset
python 06_finetune.py              # fine-tuning contrastivo SimCLR (opcional, mejora métricas)
python 07_binary_classifier.py     # entrena clasificador MTG / no-MTG (ver sección 4)
```

**Usar el scanner:**

```bash
# Identificar una carta (incluye detección MTG/no-MTG automáticamente si existe el modelo)
python scanner.py test_photos/mi_carta.jpg

# Con Test-Time Augmentation (más estable con fotos movidas o con ángulo)
python scanner.py test_photos/mi_carta.jpg --top 10 --tta 7

# Usar embeddings del modelo fine-tuneado (requiere 06_finetune.py primero)
python scanner.py test_photos/mi_carta.jpg --finetuned

# Saltar el clasificador binario y forzar búsqueda directa
python scanner.py test_photos/mi_carta.jpg --skip-detect
```

Artefactos locales (no compartidos): `pytorch/data/embeddings_pt.npy`,
`pytorch/data/index_pt.json`, `pytorch/results/`, `pytorch/models/`.

## 3. Clasificador binario MTG / No-MTG (PyTorch)

El scanner incluye una primera etapa que detecta si la imagen es una carta MTG
antes de intentar identificarla. Esto evita falsos positivos con cartas de otros
juegos, naipes de baraja española/inglesa, u otras imágenes.

**Entrenar el clasificador:**

```bash
cd pytorch

# Descarga ~3 000 imágenes de cartas Pokémon (negativos) y entrena el modelo.
# Primera ejecución: ~20 min de descarga + ~30-60 min de entrenamiento en GPU.
python 07_binary_classifier.py

# Reutilizar imágenes ya descargadas (reruns):
python 07_binary_classifier.py --skip-download

# Ajustar cantidad de cartas por clase o épocas:
python 07_binary_classifier.py --n 2000 --epochs 20
```

**Salidas generadas en `pytorch/results/`:**

| Archivo | Descripción |
|---|---|
| `confusion_matrix_binary.png` | TP / TN / FP / FN del clasificador |
| `roc_auc.png` | Curva ROC con área bajo la curva (AUC) |
| `metrics_binary_bar.png` | Accuracy, Precision, Recall, F1, ROC-AUC |
| `loss_binary.png` | Curva de pérdida train / val por época |
| `metrics_binary.json` | Métricas numéricas (para comparar con TF) |

El modelo entrenado se guarda en `pytorch/models/mtg_detector.pth` y el scanner
lo carga automáticamente en cada ejecución.

**Probar el clasificador manualmente:**

```bash
# Carta MTG → debería pasar el filtro
python scanner.py test_photos/squirreled_away.jpg

# Pokémon, baraja, u otra imagen → debería bloquearse en el paso 1
python scanner.py test_photos/pokemon_charizard.jpg
# Salida esperada:
#   ✗ La imagen NO parece una carta MTG (P=0.043 < 0.5)
#   Para forzar la búsqueda de todas formas: --skip-detect
```

## 4. Pipeline TensorFlow (MobileNetV2)

```bash
cd tensorFlow
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

```bash
python 03_build_embeddings.py                  # construye el índice de embeddings
python 03_build_embeddings.py --force          # reconstruye aunque ya exista

python 04_evaluate.py test_photos/mi_carta.jpg
python 05_visualize.py --preview                                          # grilla de cartas descargadas
python 05_visualize.py --image test_photos/mi_carta.jpg --output data/prediccion.png

python scanner.py test_photos/mi_carta.jpg --top-k 5 --threshold 0.75
```

Artefacto local (no compartido): `tensorFlow/data/indexes/magic_embeddings.pkl`.

## Notas

- `data/` en la raíz (dataset compartido) y `pytorch/data/` /
  `tensorFlow/data/` (artefactos por framework) están en `.gitignore` — no se
  versionan por tamaño.
- `01_scraper.py` cachea el dump bulk en `data/raw_cards.json`; si querés
  recalcular el filtrado con otros parámetros no hace falta re-descargar,
  solo borrar `data/cards.json` y volver a correr `01_scraper.py`.
- `02_downloader.py` es idempotente: se puede interrumpir y volver a correr,
  omite las imágenes ya descargadas.
- `07_binary_classifier.py` también es idempotente: las imágenes Pokémon ya
  descargadas no se re-descargan. El caché de metadatos se guarda en
  `data/images_negatives/pokemon_meta.json`.
- Los negativos de Pokémon se descargan desde `pokemontcg.io` (API pública,
  no requiere clave). El caché queda en `data/images_negatives/` (compartido
  entre PyTorch y TensorFlow).
