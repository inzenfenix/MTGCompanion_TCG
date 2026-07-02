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
├── 01_scraper.py       # descarga y filtra el catálogo de cartas (compartido)
├── 02_downloader.py    # descarga las imágenes del catálogo (compartido)
├── data/                # dataset compartido — se genera, no se versiona
│   ├── raw_cards.json   # cache del dump bulk de Scryfall
│   ├── cards.json       # dataset filtrado (id, name, set, rarity, colors, image_url...)
│   └── images/          # {card_id}.jpg
├── pytorch/             # pipeline PyTorch (EfficientNet_b0)
└── tensorFlow/          # pipeline TensorFlow (MobileNetV2)
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
python 03_pt_embedder.py                       # extrae embeddings del dataset compartido
python 04_evaluate.py                          # evalúa Top-1/Top-5/MRR con augmentaciones
python 05_visualize.py                         # t-SNE + EDA del dataset
python 06_finetune.py                          # fine-tuning contrastivo (SimCLR), opcional

python scanner.py test_photos/mi_carta.jpg                 # identifica una carta
python scanner.py test_photos/mi_carta.jpg --top 10 --tta 7
python scanner.py test_photos/mi_carta.jpg --finetuned     # usa el modelo de 06_finetune.py
```

Artefactos locales (no compartidos): `pytorch/data/embeddings_pt.npy`,
`pytorch/data/index_pt.json`, `pytorch/results/`, `pytorch/models/`.

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
