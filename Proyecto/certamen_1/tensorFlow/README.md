# Detector de Cartas Magic con TensorFlow

## Instalacion

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Uso

El scraping y la descarga de imágenes son compartidos con el pipeline de pytorch:
`01_scraper.py` y `02_downloader.py` viven en `certamen_1/` (un nivel arriba) y
dejan el dataset en `certamen_1/data/` (`cards.json` + `images/`).

```bash
python ../01_scraper.py --max-cards 500
python ../02_downloader.py
python 03_build_embeddings.py
python 04_evaluate.py test_photos/mi_carta.jpg
python 05_visualize.py --image test_photos/mi_carta.jpg --output data/prediccion.png
python scanner.py test_photos/mi_carta.jpg
```

Para descargar todas las cartas disponibles:

```bash
python ../01_scraper.py --max-cards 0
python 03_build_embeddings.py --force
```


