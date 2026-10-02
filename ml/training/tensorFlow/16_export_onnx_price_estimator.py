"""
MTG Card Scanner — Certamen 2, Stage 3 (ver ../../data-prep/README.md)
16_export_onnx_price_estimator.py: exporta el estimador de precio (Stage 3)
entrenado en TensorFlow a ONNX.

Espejo de 14_export_onnx_text_validator.py — mismo patrón de verificación
numérica (onnxruntime CPU vs. Keras) y misma convención de publicación en la
app Ionic (CLAUDE.md regla 3). El lado PyTorch usa `torch.onnx.export` (ver
pytorch/18_export_onnx_price_estimator.py, el script espejo de este).
Diferencia clave con Stage 2: Stage 3 es regresión — el modelo predice
log1p(price) directo, sin activación de salida (ver src/price_regressor.py),
así que la verificación compara las salidas crudas sin sigmoid.

Este script no vuelve a entrenar nada: toma el `price_regressor.keras` +
`price_regressor_cfg.json` que ya estén publicados (por 13_price_estimator.py
o 15_optuna_price_estimator.py) y los convierte.

Uso:
    python 16_export_onnx_price_estimator.py
    python 16_export_onnx_price_estimator.py --opset 18
"""

import argparse
import json
import pathlib
import shutil
import sys

import numpy as np
import onnxruntime as ort
import tensorflow as tf
import tf2onnx

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
MODELS_DIR = SCRIPT_DIR / "models"
# Misma carpeta pública que 14_export_onnx_text_validator.py.
IONIC_MODELS_DIR = SCRIPT_DIR.parent.parent.parent / "apps" / "mobile" / "public" / "models"


def array_de_entrada(input_dim: int) -> np.ndarray:
    # Array determinístico (mismo seed que 14_export_onnx_text_validator.py)
    # — alcanza para verificar que el grafo ONNX computa lo mismo que Keras.
    rng = np.random.default_rng(42)
    return rng.standard_normal((1, input_dim)).astype(np.float32)


def exportar(modelo: tf.keras.Model, input_dim: int, destino: pathlib.Path, opset: int) -> None:
    input_signature = [tf.TensorSpec([None, input_dim], tf.float32, name="features")]
    tf2onnx.convert.from_keras(
        modelo,
        input_signature=input_signature,
        opset=opset,
        output_path=str(destino),
    )


def verificar(modelo: tf.keras.Model, entrada: np.ndarray, onnx_path: pathlib.Path, tolerancia: float) -> float:
    # El modelo predice log1p(price) crudo (última Dense sin activación, ver
    # src/price_regressor.py) — comparación directa, sin sigmoid (a
    # diferencia de Stage 2, que es clasificación).
    salida_tf = modelo.predict(entrada, verbose=0)

    sesion = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    input_name = sesion.get_inputs()[0].name
    salida_onnx = sesion.run(None, {input_name: entrada})[0]

    diff = float(np.max(np.abs(salida_tf - salida_onnx)))
    if diff > tolerancia:
        raise ValueError(
            f"Diferencia máxima entre TensorFlow y ONNX ({diff:.2e}) supera la tolerancia "
            f"({tolerancia:.2e}) — no se publica el .onnx."
        )
    return diff


def publicar_en_ionic(destino: pathlib.Path, nombre_publico: str) -> pathlib.Path | None:
    """Copia el .onnx a apps/mobile/public/models/ — ver 14_export_onnx_text_validator.py."""
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
                        help="Diferencia máxima aceptable entre salidas TensorFlow/ONNX (default: 1e-4)")
    parser.add_argument("--no-ionic-copy", action="store_true",
                        help="No copiar el .onnx a apps/mobile/public/models/ (solo dejarlo en models/).")
    args = parser.parse_args()

    cfg_path = MODELS_DIR / "price_regressor_cfg.json"
    model_path = MODELS_DIR / "price_regressor.keras"
    if not model_path.exists() or not cfg_path.exists():
        print(f"Error: no existen {model_path} / {cfg_path}.")
        print("Corré 13_price_estimator.py o 15_optuna_price_estimator.py primero.")
        sys.exit(1)

    with open(cfg_path) as f:
        cfg = json.load(f)
    input_dim = cfg["input_dim"]

    print("=" * 66)
    print("  Export ONNX — Estimador de Precio (TensorFlow, Stage 3)")
    print(f"  input_dim={input_dim}  hidden_units={cfg.get('hidden_units', 256)}  "
          f"dropout={cfg.get('dropout')}")
    print("=" * 66)

    modelo = tf.keras.models.load_model(model_path)
    entrada = array_de_entrada(input_dim)

    destino = MODELS_DIR / "price_regressor.onnx"
    print(f"\nExportando a {destino} (opset {args.opset})...")
    exportar(modelo, input_dim, destino, args.opset)

    print("Verificando paridad numérica TensorFlow vs. ONNX (onnxruntime, CPU)...")
    diff = verificar(modelo, entrada, destino, args.tolerancia)
    print(f"  Diferencia máxima: {diff:.2e}  (tolerancia: {args.tolerancia:.2e})  ✓")

    tam_mb = destino.stat().st_size / 1e6
    print(f"\nModelo ONNX publicado: {destino}  ({tam_mb:.1f} MB)")

    if not args.no_ionic_copy:
        publico = publicar_en_ionic(destino, "stage3-price-estimator.onnx")
        if publico:
            print(f"Copiado a la app Ionic       : {publico}")
    print("Próximo paso: cargar este .onnx en la app Ionic con onnxruntime-web")
    print("(ver apps/README.md) — recordar que el cliente necesita")
    print("construir el vector concat(x_tab, x_vis) antes de llamar al modelo.")


if __name__ == "__main__":
    main()
