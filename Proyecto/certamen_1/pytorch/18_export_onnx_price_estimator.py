"""
MTG Card Scanner — Certamen 2, Stage 3 (ver ../../certamen_2/README.md)
18_export_onnx_price_estimator.py: exporta el estimador de precio (Stage 3)
entrenado en PyTorch a ONNX.

Espejo de 16_export_onnx_text_validator.py — mismo patrón de verificación
numérica (onnxruntime CPU vs. PyTorch) y misma convención de publicación en
la app Ionic (CLAUDE.md regla 3). Diferencia clave: Stage 2 es clasificación
binaria (aplica sigmoid antes de comparar), Stage 3 es regresión — el modelo
predice log1p(price) directo, sin activación de salida, así que la
verificación compara las salidas crudas sin sigmoid.

La entrada es el vector concat(x_tab, x_vis) de 1328 dims (48 tabular + 1280
visual, ver src/price_features.py / prepare_price_embeddings.py) — igual que
Stage 2, no hay imagen que envolver acá: la app Ionic tiene que construir ese
vector del lado del cliente antes de llamar al modelo.

Este script no vuelve a entrenar nada: toma el `price_regressor.pth` +
`price_regressor_cfg.json` que ya estén publicados (por 15_price_estimator.py
o 17_optuna_price_estimator.py) y los convierte.

Uso:
    python 18_export_onnx_price_estimator.py
    python 18_export_onnx_price_estimator.py --opset 18
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

from src.price_regressor import PriceRegressor

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
MODELS_DIR = SCRIPT_DIR / "models"
# Misma carpeta pública que 16_export_onnx_text_validator.py.
IONIC_MODELS_DIR = SCRIPT_DIR.parent.parent / "examen" / "trading-app-ionic" / "public" / "models"
DEVICE = "cpu"  # export y verificación en CPU: liviano, no compite por GPU con un entrenamiento en curso


def cargar_modelo(cfg: dict) -> PriceRegressor:
    modelo = PriceRegressor(
        input_dim=cfg["input_dim"],
        hidden_units=cfg.get("hidden_units", 256),
        dropout=cfg.get("dropout", 0.3),
    )
    modelo.load_state_dict(
        torch.load(MODELS_DIR / "price_regressor.pth", map_location=DEVICE, weights_only=True)
    )
    modelo.eval()
    return modelo


def tensor_de_entrada(input_dim: int) -> torch.Tensor:
    # Tensor determinístico (mismo seed que 16_export_onnx_text_validator.py)
    # — alcanza para verificar que el grafo ONNX computa lo mismo que el
    # modelo PyTorch, no hace falta un vector real para eso.
    torch.manual_seed(42)
    return torch.randn(1, input_dim)


def exportar(modelo: PriceRegressor, entrada: torch.Tensor, destino: pathlib.Path, opset: int) -> None:
    batch = torch.export.Dim("batch")
    torch.onnx.export(
        modelo,
        entrada,
        str(destino),
        input_names=["features"],
        output_names=["price_log1p"],
        dynamic_shapes={"x": {0: batch}},
        opset_version=opset,
    )


def verificar(modelo: PriceRegressor, entrada: torch.Tensor, onnx_path: pathlib.Path, tolerancia: float) -> float:
    onnx.checker.check_model(onnx.load(str(onnx_path)))

    with torch.no_grad():
        salida_pt = modelo(entrada).numpy()  # (B,) log1p(price) crudo, sin activación

    sesion = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    salida_onnx = sesion.run(None, {"features": entrada.numpy().astype(np.float32)})[0]

    diff = float(np.max(np.abs(salida_pt - salida_onnx.reshape(-1))))
    if diff > tolerancia:
        raise ValueError(
            f"Diferencia máxima entre PyTorch y ONNX ({diff:.2e}) supera la tolerancia "
            f"({tolerancia:.2e}) — no se publica el .onnx."
        )
    return diff


def publicar_en_ionic(destino: pathlib.Path, nombre_publico: str) -> pathlib.Path | None:
    """Copia el .onnx a trading-app-ionic/public/models/ — ver 16_export_onnx_text_validator.py."""
    if not IONIC_MODELS_DIR.parent.exists():
        print(f"  aviso: no se encontró {IONIC_MODELS_DIR.parent} — no se copia a la app Ionic.")
        return None
    IONIC_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    publico = IONIC_MODELS_DIR / nombre_publico
    shutil.copy2(destino, publico)
    return publico


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Exporta el estimador de precio (Stage 3) a ONNX y verifica paridad numérica."
    )
    parser.add_argument("--opset", type=int, default=18, help="Versión de opset ONNX (default: 18)")
    parser.add_argument("--tolerancia", type=float, default=1e-4,
                        help="Diferencia máxima aceptable entre salidas PyTorch/ONNX (default: 1e-4)")
    parser.add_argument("--no-ionic-copy", action="store_true",
                        help="No copiar el .onnx a trading-app-ionic/public/models/ (solo dejarlo en models/).")
    args = parser.parse_args()

    cfg_path = MODELS_DIR / "price_regressor_cfg.json"
    model_path = MODELS_DIR / "price_regressor.pth"
    if not model_path.exists() or not cfg_path.exists():
        print(f"Error: no existen {model_path} / {cfg_path}.")
        print("Corré 15_price_estimator.py o 17_optuna_price_estimator.py primero.")
        sys.exit(1)

    with open(cfg_path) as f:
        cfg = json.load(f)

    print("=" * 66)
    print("  Export ONNX — Estimador de Precio (PyTorch, Stage 3)")
    print(f"  input_dim={cfg['input_dim']}  hidden_units={cfg.get('hidden_units', 256)}  "
          f"dropout={cfg.get('dropout')}")
    print("=" * 66)

    modelo = cargar_modelo(cfg)
    entrada = tensor_de_entrada(cfg["input_dim"])

    destino = MODELS_DIR / "price_regressor.onnx"
    print(f"\nExportando a {destino} (opset {args.opset})...")
    exportar(modelo, entrada, destino, args.opset)

    print("Verificando paridad numérica PyTorch vs. ONNX (onnxruntime, CPU)...")
    diff = verificar(modelo, entrada, destino, args.tolerancia)
    print(f"  Diferencia máxima: {diff:.2e}  (tolerancia: {args.tolerancia:.2e})  ✓")

    tam_mb = destino.stat().st_size / 1e6
    print(f"\nModelo ONNX publicado: {destino}  ({tam_mb:.1f} MB)")

    if not args.no_ionic_copy:
        publico = publicar_en_ionic(destino, "stage3-price-estimator.onnx")
        if publico:
            print(f"Copiado a la app Ionic       : {publico}")
    print("Próximo paso: cargar este .onnx en la app Ionic con onnxruntime-web")
    print("(ver Proyecto/examen/README.md) — recordar que el cliente necesita")
    print("construir el vector concat(x_tab, x_vis) antes de llamar al modelo.")


if __name__ == "__main__":
    main()
