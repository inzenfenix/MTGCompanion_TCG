"""
MTG Card Scanner — Certamen 2, Stage 2 (ver ../../certamen_2/README.md)
16_export_onnx_text_validator.py: exporta el validador de texto (Stage 2)
entrenado en PyTorch a ONNX.

Espejo de 09_export_onnx.py / 12_export_onnx_condition.py — mismo patrón de
verificación numérica (onnxruntime CPU vs. PyTorch) y misma convención de
publicación en la app Ionic (CLAUDE.md regla 3). La diferencia con esos dos
es la entrada: acá no hay imagen — el modelo recibe directamente el vector de
4×512 features de matching (concat[v_ocr, v_ref, |diff|, producto], ver
src/text_matcher.py), así que la app Ionic tiene que calcular ese vector del
lado del cliente (mismo HashingVectorizer, portado a JS/TS o precomputado)
antes de llamar al modelo — no hay preprocesamiento de imagen que envolver acá.

Este script no vuelve a entrenar nada: toma el `text_matcher.pth` +
`text_matcher_cfg.json` que ya estén publicados (por 14_text_validator.py o
15_optuna_text_validator.py) y los convierte.

Uso:
    python 16_export_onnx_text_validator.py
    python 16_export_onnx_text_validator.py --ocr-text "Lightning Bolt" --ref-text "Lightning Bolt. Deals 3 damage."
    python 16_export_onnx_text_validator.py --opset 18
"""

import argparse
import json
import pathlib
import shutil
import sys

import numpy as np
import onnx
import onnxruntime as ort
import torch

from src.text_matcher import TextMatcher, build_vectorizer, par_a_features

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
MODELS_DIR = SCRIPT_DIR / "models"
# Misma carpeta pública que 09_export_onnx.py / 12_export_onnx_condition.py.
IONIC_MODELS_DIR = SCRIPT_DIR.parent.parent / "examen" / "trading-app-ionic" / "public" / "models"
DEVICE = "cpu"  # export y verificación en CPU: liviano, no compite por GPU con un entrenamiento en curso


def cargar_modelo(cfg: dict) -> TextMatcher:
    modelo = TextMatcher(
        input_dim=cfg.get("input_dim", 2048),
        hidden_units=cfg.get("hidden_units", 256),
        dropout=cfg.get("dropout", 0.3),
    )
    modelo.load_state_dict(
        torch.load(MODELS_DIR / "text_matcher.pth", map_location=DEVICE, weights_only=True)
    )
    modelo.eval()
    return modelo


def tensor_de_entrada(ocr_text: str | None, ref_text: str | None, input_dim: int) -> torch.Tensor:
    if ocr_text is not None or ref_text is not None:
        vectorizador = build_vectorizer()
        features = par_a_features(vectorizador, ocr_text or "", ref_text or "")
        return torch.from_numpy(features).unsqueeze(0)
    # Sin par de texto: tensor determinístico (mismo seed) — alcanza para
    # verificar que el grafo ONNX computa lo mismo que el modelo PyTorch, no
    # hace falta un par real para eso (mismo criterio que 09_export_onnx.py).
    torch.manual_seed(42)
    return torch.randn(1, input_dim)


def exportar(modelo: TextMatcher, entrada: torch.Tensor, destino: pathlib.Path, opset: int) -> None:
    batch = torch.export.Dim("batch")
    torch.onnx.export(
        modelo,
        entrada,
        str(destino),
        input_names=["features"],
        output_names=["logit"],
        dynamic_shapes={"x": {0: batch}},
        opset_version=opset,
    )


def verificar(modelo: TextMatcher, entrada: torch.Tensor, onnx_path: pathlib.Path, tolerancia: float) -> float:
    onnx.checker.check_model(onnx.load(str(onnx_path)))

    with torch.no_grad():
        salida_pt = torch.sigmoid(modelo(entrada)).numpy()

    sesion = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    logit_onnx = sesion.run(None, {"features": entrada.numpy().astype(np.float32)})[0]
    salida_onnx = 1 / (1 + np.exp(-logit_onnx))  # sigmoid manual — el grafo exporta el logit crudo

    diff = float(np.max(np.abs(salida_pt - salida_onnx.squeeze(-1))))
    if diff > tolerancia:
        raise ValueError(
            f"Diferencia máxima entre PyTorch y ONNX ({diff:.2e}) supera la tolerancia "
            f"({tolerancia:.2e}) — no se publica el .onnx."
        )
    return diff


def publicar_en_ionic(destino: pathlib.Path, nombre_publico: str) -> pathlib.Path | None:
    """Copia el .onnx a trading-app-ionic/public/models/ — ver 09_export_onnx.py."""
    if not IONIC_MODELS_DIR.parent.exists():
        print(f"  aviso: no se encontró {IONIC_MODELS_DIR.parent} — no se copia a la app Ionic.")
        return None
    IONIC_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    publico = IONIC_MODELS_DIR / nombre_publico
    shutil.copy2(destino, publico)
    return publico


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Exporta el validador de texto (Stage 2) a ONNX y verifica paridad numérica."
    )
    parser.add_argument("--ocr-text", default=None, help="Texto OCR real para verificar (default: tensor aleatorio)")
    parser.add_argument("--ref-text", default=None, help="Texto de referencia real para verificar")
    parser.add_argument("--opset", type=int, default=18, help="Versión de opset ONNX (default: 18)")
    parser.add_argument("--tolerancia", type=float, default=1e-4,
                        help="Diferencia máxima aceptable entre salidas PyTorch/ONNX (default: 1e-4)")
    parser.add_argument("--no-ionic-copy", action="store_true",
                        help="No copiar el .onnx a trading-app-ionic/public/models/ (solo dejarlo en models/).")
    args = parser.parse_args()

    cfg_path = MODELS_DIR / "text_matcher_cfg.json"
    model_path = MODELS_DIR / "text_matcher.pth"
    if not model_path.exists() or not cfg_path.exists():
        print(f"Error: no existen {model_path} / {cfg_path}.")
        print("Corré 14_text_validator.py o 15_optuna_text_validator.py primero.")
        sys.exit(1)

    with open(cfg_path) as f:
        cfg = json.load(f)

    print("=" * 66)
    print("  Export ONNX — Validador de Texto (PyTorch, Stage 2)")
    print(f"  input_dim={cfg.get('input_dim', 2048)}  hidden_units={cfg.get('hidden_units', 256)}  "
          f"dropout={cfg.get('dropout')}  umbral_optimo={cfg.get('umbral_optimo')}")
    print("=" * 66)

    modelo = cargar_modelo(cfg)
    entrada = tensor_de_entrada(args.ocr_text, args.ref_text, cfg.get("input_dim", 2048))

    destino = MODELS_DIR / "text_matcher.onnx"
    print(f"\nExportando a {destino} (opset {args.opset})...")
    exportar(modelo, entrada, destino, args.opset)

    print("Verificando paridad numérica PyTorch vs. ONNX (onnxruntime, CPU)...")
    diff = verificar(modelo, entrada, destino, args.tolerancia)
    print(f"  Diferencia máxima: {diff:.2e}  (tolerancia: {args.tolerancia:.2e})  ✓")

    tam_mb = destino.stat().st_size / 1e6
    print(f"\nModelo ONNX publicado: {destino}  ({tam_mb:.1f} MB)")

    if not args.no_ionic_copy:
        publico = publicar_en_ionic(destino, "stage2-text-validator.onnx")
        if publico:
            print(f"Copiado a la app Ionic       : {publico}")
    print("Próximo paso: cargar este .onnx en la app Ionic con onnxruntime-web")
    print("(ver Proyecto/examen/README.md) — recordar que el cliente necesita")
    print("calcular las 4×512 features de matching antes de llamar al modelo.")


if __name__ == "__main__":
    main()
