"""
MTG Card Scanner — Certamen 2, Stage 3 (ver ../../data-prep/README.md,
sección 5.1.1)
prepare_price_embeddings.py: precalcula y cachea el embedding visual
congelado (mitad x_vis del feature vector combinado) para TensorFlow.
Espejo de ../pytorch/prepare_price_embeddings.py.

Reusa el backbone YA fine-tuneado de Stage 1 (models/mtg_detector.keras) —
no ImageNet vainilla — completamente congelado (`trainable=False`, no el
freeze_ratio parcial que usó el entrenamiento de Stage 1): se descarta la
cabeza de clasificación y se usa solo el submodelo MobileNetV3Small interno
(`pooling='avg'`, salida de 576 dims). Como el backbone no cambia, su salida
es una función determinística de la imagen — se calcula UNA SOLA VEZ acá, no
en cada época de 13_price_estimator.py.

No hay flag --device (CLAUDE.md regla 6 — TensorFlow no tiene ruta de GPU en
esta máquina fuera de Docker, entrena/infiere en CPU siempre).

Uso:
    python prepare_price_embeddings.py
    python prepare_price_embeddings.py --batch-size 64
"""

import argparse
import csv
import json
import pathlib
import sys

import numpy as np
import tensorflow as tf
from PIL import Image

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
DATA_PREP_DIR = SCRIPT_DIR.parent.parent / "data-prep"
IMAGES_DIR = SCRIPT_DIR.parent / "data" / "images"
PRICE_DATASET_DIR = DATA_PREP_DIR / "data" / "price_dataset"
CARDS_CSV = PRICE_DATASET_DIR / "cards.csv"
MODELS_DIR = SCRIPT_DIR / "models"

IMG_SIZE = (224, 224)


def cargar_extractor() -> tf.keras.Model:
    """Carga mtg_detector.keras y devuelve el submodelo MobileNetV3Small
    interno (congelado) — el mismo que build_binary_classifier() envuelve
    con `base(inputs, training=False)` en src/binary_classifier.py. Se
    identifica por ser el único layer anidado que es a su vez un
    tf.keras.Model, no por nombre (más robusto que asumir el nombre exacto
    que Keras le puso al backbone)."""
    modelo = tf.keras.models.load_model(MODELS_DIR / "mtg_detector.keras")
    candidatos = [capa for capa in modelo.layers if isinstance(capa, tf.keras.Model)]
    if len(candidatos) != 1:
        raise RuntimeError(
            f"Se esperaba un único submodelo anidado (el backbone) en mtg_detector.keras, "
            f"se encontraron {len(candidatos)}."
        )
    base = candidatos[0]
    base.trainable = False
    return base


def cargar_imagen(card_id: str) -> np.ndarray | None:
    """PIL → array float32 (H, W, 3) en rango [0, 255], sin normalizar —
    MobileNetV3 incluye su propio rescaling interno (capa Rescaling), mismo
    criterio que tensorFlow/src/embeddings.py::_preprocesar()."""
    ruta = IMAGES_DIR / f"{card_id}.jpg"
    if not ruta.exists():
        return None
    try:
        with Image.open(ruta) as img:
            img = img.convert("RGB").resize(IMG_SIZE)
            return np.asarray(img, dtype=np.float32)
    except Exception:
        return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Precalcula el embedding visual congelado de Stage 3 (TensorFlow)."
    )
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()

    model_path = MODELS_DIR / "mtg_detector.keras"
    if not model_path.exists():
        print(f"Error: no existe {model_path}.")
        print("Corré 07_binary_classifier.py (Stage 1) primero.")
        sys.exit(1)
    if not CARDS_CSV.exists():
        print(f"Error: no existe {CARDS_CSV}.")
        print("Corré ml/data-prep/prepare_price_dataset.py primero.")
        sys.exit(1)

    with open(CARDS_CSV, encoding="utf-8") as f:
        filas = list(csv.DictReader(f))

    print("=" * 62)
    print("  Stage 3 — Embedding visual congelado (TensorFlow, MobileNetV3Small)")
    print(f"  Cartas : {len(filas):,}")
    print("=" * 62)

    base = cargar_extractor()

    embeddings, card_ids = [], []
    batch_arrays, batch_ids = [], []
    saltadas = 0

    def flush():
        nonlocal batch_arrays, batch_ids
        if not batch_arrays:
            return
        batch = np.stack(batch_arrays, axis=0)
        feats = base(batch, training=False).numpy()
        embeddings.extend(feats)
        card_ids.extend(batch_ids)
        batch_arrays, batch_ids = [], []

    for i, fila in enumerate(filas, start=1):
        arr = cargar_imagen(fila["card_id"])
        if arr is None:
            saltadas += 1
            continue
        batch_arrays.append(arr)
        batch_ids.append(fila["card_id"])
        if len(batch_arrays) >= args.batch_size:
            flush()
        if i % 5000 == 0 or i == len(filas):
            print(f"  {i:,}/{len(filas):,} procesadas...")

    flush()

    if saltadas:
        print(f"Saltadas (imagen faltante/corrupta): {saltadas:,}")

    if not embeddings:
        print("Error: no se generó ningún embedding.")
        sys.exit(1)

    matriz = np.stack(embeddings).astype(np.float32)
    print(f"\nEmbeddings: {matriz.shape}  (esperado: (*, 576))")

    PRICE_DATASET_DIR.mkdir(parents=True, exist_ok=True)
    npy_path = PRICE_DATASET_DIR / "tensorflow_visual_embeddings.npy"
    ids_path = PRICE_DATASET_DIR / "tensorflow_card_ids.json"
    np.save(npy_path, matriz)
    with open(ids_path, "w", encoding="utf-8") as f:
        json.dump(card_ids, f)

    print(f"\n{npy_path}")
    print(f"{ids_path}")


if __name__ == "__main__":
    main()
