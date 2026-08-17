"""
MTG Card Scanner — Certamen 2, Stage 3 del plan (ver ../../certamen_2/README.md)
11_export_onnx_condition.py: exporta el clasificador de condición (Stage 4,
NM/LP/MP/HP/DMG) entrenado en TensorFlow a ONNX.

Por qué ONNX (y no TensorFlow.js): certamen_2/README.md, sección 3 — el
pipeline final elige el mejor framework por etapa, así que la app Ionic
necesita un formato de exportación común a ambos en vez de atarse a uno solo.
Acá se resuelve el lado TensorFlow con `tf2onnx`, igual que 09_export_onnx.py
(Stage 1); el lado PyTorch usa `torch.onnx.export` (ver
pytorch/12_export_onnx_condition.py, el script espejo de este).

Este script no vuelve a entrenar nada: toma el `condition_grader_combined.keras`
+ `condition_grader_combined_cfg.json` que ya estén publicados (por
11_condition_grader_combined.py) y los convierte — el mismo checkpoint
COMBINADO (sintético + fotos reales de Roboflow) que carga
predict_condition.py del lado PyTorch, no el `condition_grader.keras` plano
de 09_condition_grader.py/10_optuna_condition_grader.py: ese plano da mejor
accuracy en su propio split pero generaliza mal a fotos reales — mismo
motivo ya documentado en CLAUDE.md y en pytorch/12_export_onnx_condition.py
para el checkpoint combinado de PyTorch (ROADMAP.md ítem I20 punto 2). Si el
modelo cambia (reentrenamiento), basta con correr
11_condition_grader_combined.py y luego este script de nuevo.

Verificación incluida: corre la misma imagen (o un array aleatorio si no se
pasa ninguna) por el modelo Keras y por el modelo ONNX exportado
(`onnxruntime`, CPU) y compara las salidas — si difieren más que una
tolerancia chica, el export se considera sospechoso y el script termina con
error en vez de publicar un .onnx silenciosamente incorrecto.

Uso:
    python 11_export_onnx_condition.py
    python 11_export_onnx_condition.py --imagen test_photos/mi_carta.jpg
    python 11_export_onnx_condition.py --opset 18
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
from PIL import Image

from src.condition_classifier import GRADOS

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
MODELS_DIR = SCRIPT_DIR / "models"
# Carpeta pública de la app Ionic (ver Proyecto/examen/README.md) — mismo
# criterio que tensorFlow/09_export_onnx.py: publicar acá evita copiar el
# .onnx a mano después de cada export.
IONIC_MODELS_DIR = SCRIPT_DIR.parent.parent / "examen" / "trading-app-ionic" / "public" / "models"
IMG_SIZE = 224


def array_de_entrada(imagen: pathlib.Path | None) -> np.ndarray:
    # Mismo preprocesamiento que build_dataset() en 09_condition_grader.py /
    # 10_optuna_condition_grader.py: MobileNetV3 hace su propio rescaling
    # como parte del grafo (ver src/condition_classifier.py), preprocess_input
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


def publicar_en_ionic(destino: pathlib.Path, nombre_publico: str) -> pathlib.Path | None:
    """Copia el .onnx a trading-app-ionic/public/models/ — ver pytorch/09_export_onnx.py."""
    if not IONIC_MODELS_DIR.parent.exists():
        print(f"  aviso: no se encontró {IONIC_MODELS_DIR.parent} — no se copia a la app Ionic.")
        return None
    IONIC_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    publico = IONIC_MODELS_DIR / nombre_publico
    shutil.copy2(destino, publico)
    return publico


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Exporta el clasificador de condición (Stage 4) a ONNX y verifica paridad numérica."
    )
    parser.add_argument("--imagen", type=pathlib.Path, default=None,
                        help="Imagen real para verificar (default: array aleatorio con seed fija)")
    parser.add_argument("--opset", type=int, default=18, help="Versión de opset ONNX (default: 18)")
    parser.add_argument("--tolerancia", type=float, default=1e-4,
                        help="Diferencia máxima aceptable entre salidas TensorFlow/ONNX (default: 1e-4)")
    parser.add_argument("--no-ionic-copy", action="store_true",
                        help="No copiar el .onnx a trading-app-ionic/public/models/ (solo dejarlo en models/).")
    args = parser.parse_args()

    cfg_path = MODELS_DIR / "condition_grader_combined_cfg.json"
    model_path = MODELS_DIR / "condition_grader_combined.keras"
    if not model_path.exists() or not cfg_path.exists():
        print(f"Error: no existen {model_path} / {cfg_path}.")
        print("Corré 11_condition_grader_combined.py primero.")
        sys.exit(1)

    with open(cfg_path) as f:
        cfg = json.load(f)

    print("=" * 66)
    print("  Export ONNX — Clasificador de Condición (TensorFlow, Stage 4)")
    print(f"  grados={cfg.get('grados', GRADOS)}  img_size={cfg.get('img_size', [IMG_SIZE, IMG_SIZE])}")
    print("=" * 66)

    modelo = tf.keras.models.load_model(model_path)
    entrada = array_de_entrada(args.imagen)

    destino = MODELS_DIR / "condition_grader_combined.onnx"
    print(f"\nExportando a {destino} (opset {args.opset})...")
    exportar(modelo, destino, args.opset)

    print("Verificando paridad numérica TensorFlow vs. ONNX (onnxruntime, CPU)...")
    diff = verificar(modelo, entrada, destino, args.tolerancia)
    print(f"  Diferencia máxima: {diff:.2e}  (tolerancia: {args.tolerancia:.2e})  ✓")

    tam_mb = destino.stat().st_size / 1e6
    print(f"\nModelo ONNX publicado: {destino}  ({tam_mb:.1f} MB)")

    if not args.no_ionic_copy:
        publico = publicar_en_ionic(destino, "stage4-condition-grader.onnx")
        if publico:
            print(f"Copiado a la app Ionic       : {publico}")
    print("Próximo paso: cargar este .onnx en la app Ionic con onnxruntime-web")
    print("(ver Proyecto/examen/README.md).")


if __name__ == "__main__":
    main()
