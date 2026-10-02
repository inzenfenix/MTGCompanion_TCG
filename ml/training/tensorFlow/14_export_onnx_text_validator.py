"""
MTG Card Scanner — Certamen 2, Stage 2 (ver ../../data-prep/README.md)
14_export_onnx_text_validator.py: exporta el validador de texto (Stage 2)
entrenado en TensorFlow a ONNX.

Espejo de 11_export_onnx_condition.py — mismo patrón de verificación
numérica (onnxruntime CPU vs. Keras) y misma convención de publicación en la
app Ionic (CLAUDE.md regla 3). El lado PyTorch usa `torch.onnx.export` (ver
pytorch/16_export_onnx_text_validator.py, el script espejo de este).
Igual que ese script, acá no hay imagen — la entrada es directamente el
vector de 4×512 features de matching (ver src/text_matcher.py); la app
Ionic tiene que calcularlo del lado del cliente antes de llamar al modelo.

Este script no vuelve a entrenar nada: toma el `text_matcher.keras` +
`text_matcher_cfg.json` que ya estén publicados (por 12_text_validator.py o
13_optuna_text_validator.py) y los convierte.

Uso:
    python 14_export_onnx_text_validator.py
    python 14_export_onnx_text_validator.py --ocr-text "Lightning Bolt" --ref-text "Lightning Bolt. Deals 3 damage."
    python 14_export_onnx_text_validator.py --opset 18
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

from src.text_matcher import N_FEATURES, build_vectorizer, par_a_features

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
MODELS_DIR = SCRIPT_DIR / "models"
# Misma carpeta pública que 11_export_onnx_condition.py.
IONIC_MODELS_DIR = SCRIPT_DIR.parent.parent.parent / "apps" / "mobile" / "public" / "models"


def array_de_entrada(ocr_text: str | None, ref_text: str | None, input_dim: int) -> np.ndarray:
    if ocr_text is not None or ref_text is not None:
        vectorizador = build_vectorizer()
        features = par_a_features(vectorizador, ocr_text or "", ref_text or "")
        return features[np.newaxis, ...].astype(np.float32)
    # Sin par de texto: array determinístico (mismo seed) — ver
    # 11_export_onnx_condition.py sobre por qué alcanza para verificar el grafo.
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
    # El grafo exporta el logit crudo (última Dense sin activación, ver
    # src/text_matcher.py) — sigmoid manual en ambos lados para comparar
    # probabilidades, mismo criterio que 09_export_onnx.py.
    logit_tf = modelo.predict(entrada, verbose=0)
    salida_tf = 1 / (1 + np.exp(-logit_tf))

    sesion = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    input_name = sesion.get_inputs()[0].name
    logit_onnx = sesion.run(None, {input_name: entrada})[0]
    salida_onnx = 1 / (1 + np.exp(-logit_onnx))

    diff = float(np.max(np.abs(salida_tf - salida_onnx)))
    if diff > tolerancia:
        raise ValueError(
            f"Diferencia máxima entre TensorFlow y ONNX ({diff:.2e}) supera la tolerancia "
            f"({tolerancia:.2e}) — no se publica el .onnx."
        )
    return diff


def publicar_en_ionic(destino: pathlib.Path, nombre_publico: str) -> pathlib.Path | None:
    """Copia el .onnx a apps/mobile/public/models/ — ver 09_export_onnx.py."""
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
    parser.add_argument("--ocr-text", default=None, help="Texto OCR real para verificar (default: array aleatorio)")
    parser.add_argument("--ref-text", default=None, help="Texto de referencia real para verificar")
    parser.add_argument("--opset", type=int, default=18, help="Versión de opset ONNX (default: 18)")
    parser.add_argument("--tolerancia", type=float, default=1e-4,
                        help="Diferencia máxima aceptable entre salidas TensorFlow/ONNX (default: 1e-4)")
    parser.add_argument("--no-ionic-copy", action="store_true",
                        help="No copiar el .onnx a apps/mobile/public/models/ (solo dejarlo en models/).")
    args = parser.parse_args()

    cfg_path = MODELS_DIR / "text_matcher_cfg.json"
    model_path = MODELS_DIR / "text_matcher.keras"
    if not model_path.exists() or not cfg_path.exists():
        print(f"Error: no existen {model_path} / {cfg_path}.")
        print("Corré 12_text_validator.py o 13_optuna_text_validator.py primero.")
        sys.exit(1)

    with open(cfg_path) as f:
        cfg = json.load(f)
    input_dim = cfg.get("input_dim", N_FEATURES * 4)

    print("=" * 66)
    print("  Export ONNX — Validador de Texto (TensorFlow, Stage 2)")
    print(f"  input_dim={input_dim}  hidden_units={cfg.get('hidden_units', 256)}  "
          f"dropout={cfg.get('dropout')}  umbral_optimo={cfg.get('umbral_optimo')}")
    print("=" * 66)

    modelo = tf.keras.models.load_model(model_path)
    entrada = array_de_entrada(args.ocr_text, args.ref_text, input_dim)

    destino = MODELS_DIR / "text_matcher.onnx"
    print(f"\nExportando a {destino} (opset {args.opset})...")
    exportar(modelo, input_dim, destino, args.opset)

    print("Verificando paridad numérica TensorFlow vs. ONNX (onnxruntime, CPU)...")
    diff = verificar(modelo, entrada, destino, args.tolerancia)
    print(f"  Diferencia máxima: {diff:.2e}  (tolerancia: {args.tolerancia:.2e})  ✓")

    tam_mb = destino.stat().st_size / 1e6
    print(f"\nModelo ONNX publicado: {destino}  ({tam_mb:.1f} MB)")

    if not args.no_ionic_copy:
        publico = publicar_en_ionic(destino, "stage2-text-validator.onnx")
        if publico:
            print(f"Copiado a la app Ionic       : {publico}")
    print("Próximo paso: cargar este .onnx en la app Ionic con onnxruntime-web")
    print("(ver apps/README.md) — recordar que el cliente necesita")
    print("calcular las 4×512 features de matching antes de llamar al modelo.")


if __name__ == "__main__":
    main()
