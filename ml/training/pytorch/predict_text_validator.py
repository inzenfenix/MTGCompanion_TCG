"""
MTG Card Scanner — Certamen 2, Stage 2
predict_text_validator.py: puntúa si un texto OCR'd corresponde al
oracle_text de referencia de una carta, usando el modelo real entrenado
(`text_matcher.pth`), no el baseline por difflib.

CLI standalone, mismo espíritu que predict_condition.py — toma los textos ya
extraídos (OCR de la foto + oracle_text de la carta identificada por Stage 1)
en vez de una imagen: el OCR en sí (pytesseract) corre en el proceso que
llama a este script (full_pipeline_demo.py, ml/data-prep/, venv liviano sin
torch) — separar OCR de matching evita instalar cv2/pytesseract acá también,
mismo motivo por el que Stage 3 separa "extraer feature visual" de "estimar
precio" (ver prepare_price_embeddings.py).

Uso:
    python predict_text_validator.py --ocr-text "..." --ref-text "..."
"""

import argparse
import json
import pathlib

import torch

from src.text_matcher import TextMatcher, build_vectorizer, par_a_features

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
MODELS_DIR = SCRIPT_DIR / "models"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

_model_cache = None
_vectorizador_cache = None
_umbral_cache = None


def cargar_matcher():
    global _model_cache, _vectorizador_cache, _umbral_cache
    if _model_cache is not None:
        return _model_cache, _vectorizador_cache, _umbral_cache

    model_path = MODELS_DIR / "text_matcher.pth"
    cfg_path = MODELS_DIR / "text_matcher_cfg.json"
    if not model_path.exists():
        return None, None, None

    cfg = {}
    if cfg_path.exists():
        with open(cfg_path) as f:
            cfg = json.load(f)

    model = TextMatcher(hidden_units=cfg.get("hidden_units", 256), dropout=cfg.get("dropout", 0.3))
    model.load_state_dict(torch.load(model_path, map_location=DEVICE, weights_only=True))
    model.eval()

    _model_cache = model.to(DEVICE)
    _vectorizador_cache = build_vectorizer()
    _umbral_cache = float(cfg.get("umbral_optimo", 0.5))
    return _model_cache, _vectorizador_cache, _umbral_cache


@torch.no_grad()
def predecir(model, vectorizador, ocr_text: str, ref_text: str) -> float:
    """Retorna la probabilidad (sigmoid del logit) de que ocr_text corresponda a ref_text."""
    x = par_a_features(vectorizador, ocr_text, ref_text)
    tensor = torch.from_numpy(x).unsqueeze(0).to(DEVICE)
    logit = model(tensor)
    return float(torch.sigmoid(logit)[0])


def main() -> None:
    parser = argparse.ArgumentParser(description="Valida un par (texto OCR, oracle_text) — Stage 2, modelo real.")
    parser.add_argument("--ocr-text", required=True, help="Texto extraído por OCR de la foto.")
    parser.add_argument("--ref-text", required=True, help="oracle_text de referencia de la carta identificada.")
    args = parser.parse_args()

    model, vectorizador, umbral = cargar_matcher()
    if model is None:
        print("Error: no existe models/text_matcher.pth — corré 14_text_validator.py primero.")
        raise SystemExit(1)

    score = predecir(model, vectorizador, args.ocr_text, args.ref_text)
    match = score >= umbral

    print(f"match={match}")
    print(f"score={score:.6f}")
    print(f"umbral={umbral:.6f}")


if __name__ == "__main__":
    main()
