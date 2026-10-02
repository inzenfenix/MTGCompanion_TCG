"""
MTG Card Scanner — Certamen 2, Stage 3 (ver ../../data-prep/README.md,
sección 5.1.1)
prepare_price_embeddings.py: precalcula y cachea el embedding visual
congelado (mitad x_vis del feature vector combinado) para PyTorch.

Reusa el backbone YA fine-tuneado de Stage 1 (models/mtg_detector.pth) —
no ImageNet vainilla — completamente congelado (no el freeze_ratio parcial
de Stage 1/4, acá es un extractor de features puro): se descarta
`MTGDetector.head` y solo se usa `.features` → `.avgpool` → `.flatten`
(salida de 1280 dims). Como el backbone no cambia, su salida es una función
determinística de la imagen — se calcula UNA SOLA VEZ acá (no en cada época
de 15_price_estimator.py), mismo motivo que Stage 2 no re-corre OCR en cada
época.

Corre después de ml/data-prep/prepare_price_dataset.py (necesita cards.csv
para saber qué card_ids procesar) y antes de 15_price_estimator.py. Vive acá
(pytorch/) y no en ml/data-prep/ porque necesita torch/torchvision cargados —
certamen_2 es el venv liviano compartido, sin frameworks de ML pesados (ver
ml/data-prep/prepare_price_dataset.py, docstring).

Uso:
    python prepare_price_embeddings.py
    python prepare_price_embeddings.py --device cpu
    python prepare_price_embeddings.py --batch-size 64
"""

import argparse
import csv
import json
import pathlib
import sys

import numpy as np
import torch
import torchvision.transforms as T
from PIL import Image

from src.binary_classifier import MTGDetector

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
DATA_PREP_DIR = SCRIPT_DIR.parent.parent / "data-prep"
IMAGES_DIR = SCRIPT_DIR.parent / "data" / "images"
PRICE_DATASET_DIR = DATA_PREP_DIR / "data" / "price_dataset"
CARDS_CSV = PRICE_DATASET_DIR / "cards.csv"
MODELS_DIR = SCRIPT_DIR / "models"

# Mismo default que el resto del pipeline — ver nota completa sobre el bug
# ROCm/MIOpen puntual en 14_text_validator.py (CLAUDE.md regla 1).
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
IMG_SIZE = 224
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

# Mismo transform de inferencia (sin augmentación) que 09_export_onnx.py —
# acá también queremos una función determinística de la imagen, no una
# muestra aleatoria de la distribución de augmentación de entrenamiento.
TRANSFORM = T.Compose([
    T.Resize((IMG_SIZE, IMG_SIZE)),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])


def cargar_extractor(cfg: dict) -> MTGDetector:
    """Reconstruye MTGDetector desde mtg_detector_cfg.json y carga los pesos
    ya fine-tuneados — mismo patrón que scanner.py::cargar_detector() /
    09_export_onnx.py::cargar_modelo(). Congela TODO el backbone (no el
    freeze_ratio parcial que se usó durante el entrenamiento de Stage 1):
    acá el modelo es un extractor de features puro, no se sigue entrenando."""
    modelo = MTGDetector(
        freeze_ratio=cfg.get("freeze_ratio", 0.65),
        head_units=cfg.get("head_units", 256),
        dropout=cfg.get("dropout"),
    )
    modelo.load_state_dict(
        torch.load(MODELS_DIR / "mtg_detector.pth", map_location=DEVICE, weights_only=True)
    )
    for p in modelo.parameters():
        p.requires_grad = False
    modelo.eval()
    return modelo.to(DEVICE)


def cargar_imagen(card_id: str) -> torch.Tensor | None:
    ruta = IMAGES_DIR / f"{card_id}.jpg"
    if not ruta.exists():
        return None
    try:
        img = Image.open(ruta).convert("RGB")
    except Exception:
        return None
    return TRANSFORM(img)


@torch.no_grad()
def embeber_batch(modelo: MTGDetector, tensores: list[torch.Tensor]) -> np.ndarray:
    batch = torch.stack(tensores).to(DEVICE)
    h = modelo.flatten(modelo.avgpool(modelo.features(batch)))  # (B, 1280)
    return h.cpu().numpy().astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Precalcula el embedding visual congelado de Stage 3 (PyTorch)."
    )
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"],
                         help="'auto' (default) usa GPU si torch.cuda.is_available().")
    args = parser.parse_args()

    global DEVICE
    if args.device != "auto":
        DEVICE = args.device

    cfg_path = MODELS_DIR / "mtg_detector_cfg.json"
    model_path = MODELS_DIR / "mtg_detector.pth"
    if not model_path.exists() or not cfg_path.exists():
        print(f"Error: no existen {model_path} / {cfg_path}.")
        print("Corré 07_binary_classifier.py (Stage 1) primero.")
        sys.exit(1)
    if not CARDS_CSV.exists():
        print(f"Error: no existe {CARDS_CSV}.")
        print("Corré ml/data-prep/prepare_price_dataset.py primero.")
        sys.exit(1)

    with open(cfg_path) as f:
        cfg = json.load(f)
    with open(CARDS_CSV, encoding="utf-8") as f:
        filas = list(csv.DictReader(f))

    print("=" * 62)
    print("  Stage 3 — Embedding visual congelado (PyTorch, EfficientNet_b0)")
    print(f"  Device : {DEVICE}")
    print(f"  Cartas : {len(filas):,}")
    print("=" * 62)

    modelo = cargar_extractor(cfg)

    embeddings, card_ids = [], []
    batch_tensores, batch_ids = [], []
    saltadas = 0

    def flush():
        nonlocal batch_tensores, batch_ids
        if not batch_tensores:
            return
        feats = embeber_batch(modelo, batch_tensores)
        embeddings.extend(feats)
        card_ids.extend(batch_ids)
        batch_tensores, batch_ids = [], []

    for i, fila in enumerate(filas, start=1):
        tensor = cargar_imagen(fila["card_id"])
        if tensor is None:
            saltadas += 1
            continue
        batch_tensores.append(tensor)
        batch_ids.append(fila["card_id"])
        if len(batch_tensores) >= args.batch_size:
            flush()
        if i % 5000 == 0 or i == len(filas):
            print(f"  {i:,}/{len(filas):,} procesadas...")

    flush()

    if saltadas:
        print(f"Saltadas (imagen faltante/corrupta): {saltadas:,}")

    if not embeddings:
        print("Error: no se generó ningún embedding.")
        sys.exit(1)

    matriz = np.stack(embeddings)
    print(f"\nEmbeddings: {matriz.shape}  (esperado: (*, 1280))")

    PRICE_DATASET_DIR.mkdir(parents=True, exist_ok=True)
    npy_path = PRICE_DATASET_DIR / "pytorch_visual_embeddings.npy"
    ids_path = PRICE_DATASET_DIR / "pytorch_card_ids.json"
    np.save(npy_path, matriz)
    with open(ids_path, "w", encoding="utf-8") as f:
        json.dump(card_ids, f)

    print(f"\n{npy_path}")
    print(f"{ids_path}")


if __name__ == "__main__":
    main()
