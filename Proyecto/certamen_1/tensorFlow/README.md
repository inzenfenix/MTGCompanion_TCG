# Detector de Cartas Magic con TensorFlow

## Instalacion

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Uso

```bash
python 01_scraper.py
python 02_downloader.py --max-cards 500
python 03_build_embeddings.py
python 04_evaluate.py test_photos/mi_carta.jpg
python 05_visualize.py --image test_photos/mi_carta.jpg --output data/prediccion.png
python scanner.py test_photos/mi_carta.jpg
```

Para descargar todas las cartas disponibles:

```bash
python 02_downloader.py --all
python 03_build_embeddings.py --force
```


