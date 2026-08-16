"""
MTG Card Scanner — Certamen 2, Stage 3 del plan (ver ../../certamen_2/README.md)
09_export_onnx.py: exporta el detector MTG/no-MTG entrenado a ONNX.

Por qué ONNX (y no TensorFlow.js): certamen_2/README.md, sección 3 — el
pipeline final elige el mejor framework por etapa, así que la app Ionic
necesita un formato de exportación común a ambos en vez de atarse a uno solo.
Acá se resuelve el lado PyTorch con `torch.onnx.export`; el lado TensorFlow
usa `tf2onnx` (ver tensorFlow/, cuando exista el script equivalente).

Este script no vuelve a entrenar nada: toma el `mtg_detector.pth` +
`mtg_detector_cfg.json` que ya estén publicados (por 07_binary_classifier.py
o 08_optuna_binary_classifier.py) y los convierte. Si el modelo cambia
(reentrenamiento, nueva corrida de Optuna), basta con correr este script de
nuevo — no hace falta tocarlo.

Verificación incluida: corre la misma imagen (o un tensor aleatorio si no se
pasa ninguna) por el modelo PyTorch y por el modelo ONNX exportado
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
import shutil
import sys

import numpy as np
import onnx
import onnxruntime as ort
import torch
import torchvision.transforms as T
from PIL import Image

from src.binary_classifier import MTGDetector

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
MODELS_DIR = SCRIPT_DIR / "models"
# Carpeta pública de la app Ionic (ver Proyecto/examen/README.md) — el nombre
# fijo stage1-detector.onnx es el que stage1Detector.ts busca por default
# (VITE_STAGE1_MODEL_URL). Publicar acá directamente evita el paso manual de
# copiar el .onnx a mano después de cada export.
IONIC_MODELS_DIR = SCRIPT_DIR.parent.parent / "examen" / "trading-app-ionic" / "public" / "models"
IMG_SIZE = 224
DEVICE = "cpu"  # el export y la verificación corren en CPU: liviano, y no compite por la GPU con un entrenamiento en curso

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

TRANSFORM = T.Compose([
    T.Resize((IMG_SIZE, IMG_SIZE)),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])


def cargar_modelo(cfg: dict) -> MTGDetector:
    modelo = MTGDetector(
        freeze_ratio=cfg.get("freeze_ratio", 0.65),
        head_units=cfg.get("head_units", 256),
        dropout=cfg.get("dropout"),
    )
    modelo.load_state_dict(
        torch.load(MODELS_DIR / "mtg_detector.pth", map_location=DEVICE, weights_only=True)
    )
    modelo.eval()
    return modelo


def tensor_de_entrada(imagen: pathlib.Path | None) -> torch.Tensor:
    if imagen is not None:
        img = Image.open(imagen).convert("RGB")
        return TRANSFORM(img).unsqueeze(0)
    # Sin imagen: tensor determinístico (mismo seed) — alcanza para verificar
    # que el grafo ONNX computa lo mismo que el modelo PyTorch, no hace falta
    # una carta real para eso.
    torch.manual_seed(42)
    return torch.randn(1, 3, IMG_SIZE, IMG_SIZE)


def exportar(modelo: MTGDetector, entrada: torch.Tensor, destino: pathlib.Path, opset: int) -> None:
    # dynamic_shapes (no dynamic_axes) — el exporter dynamo-based de torch>=2.x
    # lo pide así; la clave debe matchear el nombre del parámetro posicional
    # de MTGDetector.forward(self, x).
    batch = torch.export.Dim("batch")
    torch.onnx.export(
        modelo,
        entrada,
        str(destino),
        input_names=["imagen"],
        output_names=["logit"],
        dynamic_shapes={"x": {0: batch}},
        opset_version=opset,
        # external_data=True es el default del exporter dynamo-based (torch>=2.x) —
        # separa los pesos en un archivo .onnx.data sidecar incluso para modelos
        # chicos como este. publicar_en_ionic() solo copia el .onnx, no ese sidecar,
        # así que el modelo publicado quedaba roto (onnxruntime no podía cargarlo
        # sin el .data al lado). False = todo inline en un solo archivo .onnx.
        external_data=False,
    )


def verificar(modelo: MTGDetector, entrada: torch.Tensor, onnx_path: pathlib.Path, tolerancia: float) -> float:
    onnx.checker.check_model(onnx.load(str(onnx_path)))

    with torch.no_grad():
        salida_pt = torch.sigmoid(modelo(entrada)).numpy()

    sesion = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    logit_onnx = sesion.run(None, {"imagen": entrada.numpy().astype(np.float32)})[0]
    salida_onnx = 1 / (1 + np.exp(-logit_onnx))  # sigmoid manual — el grafo exporta el logit crudo

    diff = float(np.max(np.abs(salida_pt - salida_onnx.squeeze(-1))))
    if diff > tolerancia:
        raise ValueError(
            f"Diferencia máxima entre PyTorch y ONNX ({diff:.2e}) supera la tolerancia "
            f"({tolerancia:.2e}) — no se publica el .onnx."
        )
    return diff


def publicar_en_ionic(destino: pathlib.Path, nombre_publico: str) -> pathlib.Path | None:
    """
    Copia el .onnx recién exportado a trading-app-ionic/public/models/, con el
    nombre fijo que espera el cliente ONNX del lado del frontend. Si la
    carpeta del frontend no existe en esta máquina (ej. corriendo solo el
    pipeline de Python, sin el monorepo completo), no falla: solo avisa.
    """
    if not IONIC_MODELS_DIR.parent.exists():  # public/ — indicio de que trading-app-ionic sí está presente
        print(f"  aviso: no se encontró {IONIC_MODELS_DIR.parent} — no se copia a la app Ionic.")
        return None
    IONIC_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    publico = IONIC_MODELS_DIR / nombre_publico
    shutil.copy2(destino, publico)
    # Defensa en profundidad: exportar() pasa external_data=False a propósito
    # (ver ahí el porqué), así que hoy `destino` siempre es autocontenido — pero
    # si algún día un modelo crece lo suficiente como para justificar volver a
    # external_data=True, un .onnx.data sidecar junto a `destino` quedaría sin
    # copiar silenciosamente (el bug real que este mismo commit corrigió) si no
    # lo contemplamos acá también.
    sidecar = destino.with_name(destino.name + ".data")
    if sidecar.exists():
        shutil.copy2(sidecar, publico.with_name(publico.name + ".data"))
    return publico


def main() -> None:
    parser = argparse.ArgumentParser(description="Exporta el detector MTG/no-MTG a ONNX y verifica paridad numérica.")
    parser.add_argument("--imagen", type=pathlib.Path, default=None,
                        help="Imagen real para verificar (default: tensor aleatorio con seed fija)")
    parser.add_argument("--opset", type=int, default=18, help="Versión de opset ONNX (default: 18)")
    parser.add_argument("--tolerancia", type=float, default=1e-4,
                        help="Diferencia máxima aceptable entre salidas PyTorch/ONNX (default: 1e-4)")
    parser.add_argument("--no-ionic-copy", action="store_true",
                        help="No copiar el .onnx a trading-app-ionic/public/models/ (solo dejarlo en models/).")
    args = parser.parse_args()

    cfg_path = MODELS_DIR / "mtg_detector_cfg.json"
    model_path = MODELS_DIR / "mtg_detector.pth"
    if not model_path.exists() or not cfg_path.exists():
        print(f"Error: no existen {model_path} / {cfg_path}.")
        print("Corré 07_binary_classifier.py o 08_optuna_binary_classifier.py primero.")
        sys.exit(1)

    with open(cfg_path) as f:
        cfg = json.load(f)

    print("=" * 66)
    print("  Export ONNX — Detector MTG/no-MTG (PyTorch)")
    print(f"  head_units={cfg.get('head_units', 256)}  freeze_ratio={cfg.get('freeze_ratio', 0.65)}  "
          f"dropout={cfg.get('dropout')}")
    print("=" * 66)

    modelo = cargar_modelo(cfg)
    entrada = tensor_de_entrada(args.imagen)

    destino = MODELS_DIR / "mtg_detector.onnx"
    print(f"\nExportando a {destino} (opset {args.opset})...")
    exportar(modelo, entrada, destino, args.opset)

    print("Verificando paridad numérica PyTorch vs. ONNX (onnxruntime, CPU)...")
    diff = verificar(modelo, entrada, destino, args.tolerancia)
    print(f"  Diferencia máxima: {diff:.2e}  (tolerancia: {args.tolerancia:.2e})  ✓")

    tam_mb = destino.stat().st_size / 1e6
    print(f"\nModelo ONNX publicado: {destino}  ({tam_mb:.1f} MB)")

    if not args.no_ionic_copy:
        publico = publicar_en_ionic(destino, "stage1-detector.onnx")
        if publico:
            print(f"Copiado a la app Ionic       : {publico}")
    print("Próximo paso: cargar este .onnx en la app Ionic con onnxruntime-web")
    print("(ver Proyecto/examen/README.md).")


if __name__ == "__main__":
    main()
