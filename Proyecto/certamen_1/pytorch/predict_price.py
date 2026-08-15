"""
MTG Card Scanner — Certamen 2, Stage 3
predict_price.py: estima el precio (USD) de una carta ya identificada,
usando el modelo real entrenado (`price_regressor.pth`) sobre
concat(x_tab, x_vis) — no el baseline tabular-only.

CLI standalone, mismo espíritu que predict_condition.py. Toma:
  - la imagen ya localizada/normalizada de la carta (misma convención que
    Stage 4 — el backbone de Stage 1 que reusamos para el embedding visual
    se entrenó sobre recortes limpios, no fotos con fondo)
  - los metadatos crudos de la carta ya identificada por Stage 1 (un dict
    estilo cards.json: cmc/rarity/set_type/frame/border_color/colors/
    color_identity/finishes/frame_effects/released_at/type_line), como un
    archivo JSON — full_pipeline_demo.py arma este JSON a partir de la
    carta que Stage 1 identificó en el catálogo local.

Uso:
    python predict_price.py <imagen> --card-json <ruta.json>
"""

import argparse
import json
import pathlib

import numpy as np
import torch
import torchvision.transforms as T
from PIL import Image

from src.binary_classifier import MTGDetector
from src.price_features import build_tabular_vector, escalar_numericos, raw_card_fields
from src.price_regressor import PriceRegressor

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
MODELS_DIR = SCRIPT_DIR / "models"
CERTAMEN2_DIR = SCRIPT_DIR.parent.parent / "certamen_2"
SCALER_JSON = CERTAMEN2_DIR / "data" / "price_dataset" / "tabular_scaler.json"

IMG_SIZE = 224
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

# Mismo transform de inferencia (sin augmentación) que prepare_price_embeddings.py.
TRANSFORM = T.Compose([
    T.Resize((IMG_SIZE, IMG_SIZE)),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])

_extractor_cache = None
_regressor_cache = None
_scaler_cache = None


def cargar_extractor_visual():
    """Backbone de Stage 1 ya fine-tuneado, congelado como extractor puro — mismo patrón que prepare_price_embeddings.py."""
    global _extractor_cache
    if _extractor_cache is not None:
        return _extractor_cache

    model_path = MODELS_DIR / "mtg_detector.pth"
    cfg_path = MODELS_DIR / "mtg_detector_cfg.json"
    if not model_path.exists():
        return None

    cfg = {}
    if cfg_path.exists():
        with open(cfg_path) as f:
            cfg = json.load(f)

    modelo = MTGDetector(freeze_ratio=cfg.get("freeze_ratio", 0.65), head_units=cfg.get("head_units", 256), dropout=cfg.get("dropout"))
    modelo.load_state_dict(torch.load(model_path, map_location=DEVICE, weights_only=True))
    for p in modelo.parameters():
        p.requires_grad = False
    modelo.eval()
    _extractor_cache = modelo.to(DEVICE)
    return _extractor_cache


def cargar_regresor():
    global _regressor_cache
    if _regressor_cache is not None:
        return _regressor_cache

    model_path = MODELS_DIR / "price_regressor.pth"
    cfg_path = MODELS_DIR / "price_regressor_cfg.json"
    if not model_path.exists():
        return None

    with open(cfg_path) as f:
        cfg = json.load(f)

    modelo = PriceRegressor(input_dim=cfg["input_dim"], hidden_units=cfg["hidden_units"], dropout=cfg["dropout"])
    modelo.load_state_dict(torch.load(model_path, map_location=DEVICE, weights_only=True))
    modelo.eval()
    _regressor_cache = modelo.to(DEVICE)
    return _regressor_cache


def cargar_scaler():
    global _scaler_cache
    if _scaler_cache is not None:
        return _scaler_cache
    with open(SCALER_JSON) as f:
        datos = json.load(f)
    _scaler_cache = (datos["mean"], datos["std"])
    return _scaler_cache


@torch.no_grad()
def embeber_imagen(extractor: MTGDetector, img_path: str) -> np.ndarray:
    img = Image.open(img_path).convert("RGB")
    tensor = TRANSFORM(img).unsqueeze(0).to(DEVICE)
    h = extractor.flatten(extractor.avgpool(extractor.features(tensor)))
    return h.cpu().numpy()[0].astype(np.float32)


def main() -> None:
    parser = argparse.ArgumentParser(description="Estima el precio (USD) de una carta ya identificada — Stage 3, modelo real.")
    parser.add_argument("imagen", help="Ruta a la imagen de la carta (ya localizada/normalizada).")
    parser.add_argument("--card-json", required=True, help="Ruta a un JSON con los metadatos crudos de la carta identificada.")
    args = parser.parse_args()

    img_path = pathlib.Path(args.imagen)
    if not img_path.exists():
        print(f"Error: archivo no encontrado: {img_path}")
        raise SystemExit(1)

    card_json_path = pathlib.Path(args.card_json)
    if not card_json_path.exists():
        print(f"Error: archivo no encontrado: {card_json_path}")
        raise SystemExit(1)

    extractor = cargar_extractor_visual()
    regresor = cargar_regresor()
    if extractor is None or regresor is None:
        print("Error: no existen models/mtg_detector.pth y/o models/price_regressor.pth — corré 07_binary_classifier.py y 15_price_estimator.py primero.")
        raise SystemExit(1)

    with open(card_json_path, encoding="utf-8") as f:
        card = json.load(f)

    medias, desvios = cargar_scaler()
    x_tab = build_tabular_vector(raw_card_fields(card))
    x_tab = escalar_numericos(x_tab, medias, desvios)
    x_vis = embeber_imagen(extractor, str(img_path))
    x = np.concatenate([np.array(x_tab, dtype=np.float32), x_vis])

    with torch.no_grad():
        tensor = torch.from_numpy(x).unsqueeze(0).to(DEVICE)
        pred_log = regresor(tensor)[0].item()

    precio_usd = max(0.0, float(np.expm1(pred_log)))

    print(f"precio_usd={precio_usd:.2f}")
    print(f"precio_log1p={pred_log:.6f}")


if __name__ == "__main__":
    main()
