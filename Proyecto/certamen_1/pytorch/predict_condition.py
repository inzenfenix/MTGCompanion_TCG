"""
MTG Card Scanner — Certamen 2, Stage 4
predict_condition.py: clasifica la condición (NM/LP/MP/HP/DMG) de una carta ya
recortada/normalizada (ver ../../certamen_2/card_preprocessing.py).

CLI standalone, en el mismo espíritu que scanner.py — salida parseable para
que certamen_2/full_pipeline_demo.py la invoque como subproceso (así no hace
falta instalar torch en certamen_2/.venv). PyTorch es el framework ganador de
Stage 4 (0.7475 acc vs. 0.6550 de TensorFlow, ver certamen_2/README.md
sección 9) — es el que corre en el pipeline; la versión TensorFlow
(tensorFlow/09_condition_grader.py) queda disponible para seguir comparando,
no para producción.

Uso:
    python predict_condition.py <imagen>
"""

import argparse
import json
import pathlib

import torch
import torchvision.transforms as T
from PIL import Image

from src.condition_classifier import GRADOS, ConditionGrader

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
MODELS_DIR = SCRIPT_DIR / "models"
IMG_SIZE = 224
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

TRANSFORM = T.Compose([
    T.Resize((IMG_SIZE, IMG_SIZE)),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])

_grader_cache = None


def cargar_grader():
    global _grader_cache
    if _grader_cache is not None:
        return _grader_cache

    model_path = MODELS_DIR / "condition_grader.pth"
    cfg_path = MODELS_DIR / "condition_grader_cfg.json"
    if not model_path.exists():
        return None

    cfg = {}
    if cfg_path.exists():
        with open(cfg_path) as f:
            cfg = json.load(f)

    model = ConditionGrader(
        freeze_ratio=cfg.get("freeze_ratio", 0.65),
        head_units=cfg.get("head_units", 256),
        dropout=cfg.get("dropout"),
    )
    model.load_state_dict(torch.load(model_path, map_location=DEVICE, weights_only=True))
    model.eval()
    _grader_cache = model.to(DEVICE)
    return _grader_cache


def predecir(model, img_path: str) -> tuple:
    """Retorna (grado_predicho, confianza, {grado: prob})."""
    img = Image.open(img_path).convert("RGB")
    tensor = TRANSFORM(img).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits, dim=1)[0].cpu()
    idx = int(probs.argmax())
    todas = {grado: float(p) for grado, p in zip(GRADOS, probs.tolist())}
    return GRADOS[idx], float(probs[idx]), todas


def main() -> None:
    parser = argparse.ArgumentParser(description="Clasifica la condición de una carta (Stage 4).")
    parser.add_argument("imagen", help="Ruta a la imagen de la carta (idealmente ya recortada/normalizada)")
    args = parser.parse_args()

    img_path = pathlib.Path(args.imagen)
    if not img_path.exists():
        print(f"Error: archivo no encontrado: {img_path}")
        raise SystemExit(1)

    model = cargar_grader()
    if model is None:
        print("Error: no existe models/condition_grader.pth — corré 10_condition_grader.py primero.")
        raise SystemExit(1)

    grado, confianza, todas = predecir(model, str(img_path))

    print(f"grado={grado}")
    print(f"confianza={confianza:.6f}")
    for g, p in todas.items():
        print(f"prob_{g}={p:.6f}")


if __name__ == "__main__":
    main()
