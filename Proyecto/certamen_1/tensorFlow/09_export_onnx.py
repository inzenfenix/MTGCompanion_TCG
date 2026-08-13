"""
MTG Card Scanner — Certamen 2, Stage 3 del plan (ver ../../certamen_2/README.md)
09_export_onnx.py: exporta el detector MTG/no-MTG entrenado (TensorFlow) a ONNX.

Por qué ONNX (y no TensorFlow.js): certamen_2/README.md, sección 3 — el
pipeline final elige el mejor framework por etapa, así que la app Ionic
necesita un formato de exportación común a ambos en vez de atarse a uno solo.
Acá se resuelve el lado TensorFlow con `tf2onnx`; el lado PyTorch usa
`torch.onnx.export` (ver pytorch/09_export_onnx.py, el script espejo de este).

Este script no vuelve a entrenar nada: toma el `mtg_detector.keras` +
`mtg_detector_cfg.json` que ya estén publicados (por 07_binary_classifier.py
o 08_optuna_binary_classifier.py) y los convierte. Si el modelo cambia
(reentrenamiento, nueva corrida de Optuna), basta con correr este script de
nuevo — no hace falta tocarlo.

Verificación incluida: corre la misma imagen (o un array aleatorio si no se
pasa ninguna) por el modelo Keras y por el modelo ONNX exportado
(`onnxruntime`, CPU) y compara las salidas — si difieren más que una
tolerancia chica, el export se considera sospechoso y el script termina con
error en vez de publicar un .onnx silenciosamente incorrecto.

Uso:
    python 09_export_onnx.py
    python 09_export_onnx.py --imagen test_photos/mi_carta.jpg
    python 09_export_onnx.py --opset 18
"""

import argparse
import json
import pathlib
import sys

import numpy as np
import onnxruntime as ort
import tensorflow as tf
import tf2onnx
from PIL import Image

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
MODELS_DIR = SCRIPT_DIR / "models"
IMG_SIZE = 224


def array_de_entrada(imagen: pathlib.Path | None) -> np.ndarray:
    # Mismo preprocesamiento que build_dataset() en 07_binary_classifier.py /
    # 08_optuna_binary_classifier.py: MobileNetV3 hace su propio rescaling
    # como parte del grafo (ver src/binary_classifier.py), preprocess_input
    # solo lo deja en el rango que espera esa capa.
    preprocess = tf.keras.applications.mobilenet_v3.preprocess_input
    if imagen is not None:
        img = Image.open(imagen).convert("RGB").resize((IMG_SIZE, IMG_SIZE))
        arr = np.asarray(img, dtype=np.float32)[np.newaxis, ...]
    else:
        # Sin imagen: array determinístico (mismo seed) — alcanza para
        # verificar que el grafo ONNX computa lo mismo que el modelo Keras,
        # no hace falta una carta real para eso.
        rng = np.random.default_rng(42)
        arr = rng.uniform(0, 255, size=(1, IMG_SIZE, IMG_SIZE, 3)).astype(np.float32)
    return preprocess(arr)


def exportar(modelo: tf.keras.Model, destino: pathlib.Path, opset: int) -> None:
    input_signature = [tf.TensorSpec([None, IMG_SIZE, IMG_SIZE, 3], tf.float32, name="imagen")]
    tf2onnx.convert.from_keras(
        modelo,
        input_signature=input_signature,
        opset=opset,
        output_path=str(destino),
    )


def verificar(modelo: tf.keras.Model, entrada: np.ndarray, onnx_path: pathlib.Path, tolerancia: float) -> float:
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Exporta el detector MTG/no-MTG a ONNX y verifica paridad numérica.")
    parser.add_argument("--imagen", type=pathlib.Path, default=None,
                        help="Imagen real para verificar (default: array aleatorio con seed fija)")
    parser.add_argument("--opset", type=int, default=18, help="Versión de opset ONNX (default: 18)")
    parser.add_argument("--tolerancia", type=float, default=1e-4,
                        help="Diferencia máxima aceptable entre salidas TensorFlow/ONNX (default: 1e-4)")
    args = parser.parse_args()

    cfg_path = MODELS_DIR / "mtg_detector_cfg.json"
    model_path = MODELS_DIR / "mtg_detector.keras"
    if not model_path.exists() or not cfg_path.exists():
        print(f"Error: no existen {model_path} / {cfg_path}.")
        print("Corré 07_binary_classifier.py o 08_optuna_binary_classifier.py primero.")
        sys.exit(1)

    with open(cfg_path) as f:
        cfg = json.load(f)

    print("=" * 66)
    print("  Export ONNX — Detector MTG/no-MTG (TensorFlow)")
    print(f"  threshold={cfg.get('threshold', 0.5)}  img_size={cfg.get('img_size', [IMG_SIZE, IMG_SIZE])}")
    print("=" * 66)

    modelo = tf.keras.models.load_model(model_path)
    entrada = array_de_entrada(args.imagen)

    destino = MODELS_DIR / "mtg_detector.onnx"
    print(f"\nExportando a {destino} (opset {args.opset})...")
    exportar(modelo, destino, args.opset)

    print("Verificando paridad numérica TensorFlow vs. ONNX (onnxruntime, CPU)...")
    diff = verificar(modelo, entrada, destino, args.tolerancia)
    print(f"  Diferencia máxima: {diff:.2e}  (tolerancia: {args.tolerancia:.2e})  ✓")

    tam_mb = destino.stat().st_size / 1e6
    print(f"\nModelo ONNX publicado: {destino}  ({tam_mb:.1f} MB)")
    print("Próximo paso: cargar este .onnx en la app Ionic con onnxruntime-web")
    print("(ver Proyecto/examen/README.md).")


if __name__ == "__main__":
    main()
