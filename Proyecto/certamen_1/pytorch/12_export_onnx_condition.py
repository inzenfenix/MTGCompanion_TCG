"""
MTG Card Scanner — Certamen 2, Stage 3 del plan (ver ../../certamen_2/README.md)
12_export_onnx_condition.py: exporta el clasificador de condición (Stage 4,
NM/LP/MP/HP/DMG) entrenado en PyTorch a ONNX.

Por qué ONNX (y no TensorFlow.js): certamen_2/README.md, sección 3 — el
pipeline final elige el mejor framework por etapa, así que la app Ionic
necesita un formato de exportación común a ambos en vez de atarse a uno solo.
Acá se resuelve el lado PyTorch con `torch.onnx.export`, igual que
09_export_onnx.py (Stage 1); el lado TensorFlow usa `tf2onnx` (ver
tensorFlow/11_export_onnx_condition.py, el script espejo de este).

Este script no vuelve a entrenar nada: toma el `condition_grader.pth` +
`condition_grader_cfg.json` que ya estén publicados (por
10_condition_grader.py o 11_optuna_condition_grader.py) y los convierte. Si
el modelo cambia (reentrenamiento, nueva corrida de Optuna), basta con correr
este script de nuevo — no hace falta tocarlo.

Verificación incluida: corre la misma imagen (o un tensor aleatorio si no se
pasa ninguna) por el modelo PyTorch y por el modelo ONNX exportado
(`onnxruntime`, CPU) y compara las salidas — si difieren más que una
tolerancia chica, el export se considera sospechoso y el script termina con
error en vez de publicar un .onnx silenciosamente incorrecto.

Uso:
    python 12_export_onnx_condition.py
    python 12_export_onnx_condition.py --imagen test_photos/mi_carta.jpg
    python 12_export_onnx_condition.py --opset 18
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

from src.condition_classifier import GRADOS, ConditionGrader

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
MODELS_DIR = SCRIPT_DIR / "models"
# Carpeta pública de la app Ionic (ver Proyecto/examen/README.md) — mismo
# criterio que pytorch/09_export_onnx.py: publicar acá evita copiar el .onnx
# a mano después de cada export.
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


def cargar_modelo(cfg: dict) -> ConditionGrader:
    modelo = ConditionGrader(
        freeze_ratio=cfg.get("freeze_ratio", 0.65),
        head_units=cfg.get("head_units", 256),
        dropout=cfg.get("dropout"),
    )
    modelo.load_state_dict(
        torch.load(MODELS_DIR / "condition_grader.pth", map_location=DEVICE, weights_only=True)
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


def exportar(modelo: ConditionGrader, entrada: torch.Tensor, destino: pathlib.Path, opset: int) -> None:
    # dynamic_shapes (no dynamic_axes) — el exporter dynamo-based de torch>=2.x
    # lo pide así; la clave debe matchear el nombre del parámetro posicional
    # de ConditionGrader.forward(self, x).
    batch = torch.export.Dim("batch")
    torch.onnx.export(
        modelo,
        entrada,
        str(destino),
        input_names=["imagen"],
        output_names=["logits"],
        dynamic_shapes={"x": {0: batch}},
        opset_version=opset,
    )


def verificar(modelo: ConditionGrader, entrada: torch.Tensor, onnx_path: pathlib.Path, tolerancia: float) -> float:
    onnx.checker.check_model(onnx.load(str(onnx_path)))

    with torch.no_grad():
        salida_pt = torch.softmax(modelo(entrada), dim=1).numpy()

    sesion = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    logits_onnx = sesion.run(None, {"imagen": entrada.numpy().astype(np.float32)})[0]
    # softmax manual — el grafo exporta los logits crudos, igual que
    # 09_export_onnx.py exporta el logit crudo de MTGDetector.
    exp = np.exp(logits_onnx - np.max(logits_onnx, axis=1, keepdims=True))
    salida_onnx = exp / exp.sum(axis=1, keepdims=True)

    diff = float(np.max(np.abs(salida_pt - salida_onnx)))
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
        description="Exporta el clasificador de condición (Stage 4) a ONNX y verifica paridad numérica."
    )
    parser.add_argument("--imagen", type=pathlib.Path, default=None,
                        help="Imagen real para verificar (default: tensor aleatorio con seed fija)")
    parser.add_argument("--opset", type=int, default=18, help="Versión de opset ONNX (default: 18)")
    parser.add_argument("--tolerancia", type=float, default=1e-4,
                        help="Diferencia máxima aceptable entre salidas PyTorch/ONNX (default: 1e-4)")
    parser.add_argument("--no-ionic-copy", action="store_true",
                        help="No copiar el .onnx a trading-app-ionic/public/models/ (solo dejarlo en models/).")
    args = parser.parse_args()

    cfg_path = MODELS_DIR / "condition_grader_cfg.json"
    model_path = MODELS_DIR / "condition_grader.pth"
    if not model_path.exists() or not cfg_path.exists():
        print(f"Error: no existen {model_path} / {cfg_path}.")
        print("Corré 10_condition_grader.py o 11_optuna_condition_grader.py primero.")
        sys.exit(1)

    with open(cfg_path) as f:
        cfg = json.load(f)

    print("=" * 66)
    print("  Export ONNX — Clasificador de Condición (PyTorch, Stage 4)")
    print(f"  grados={cfg.get('grados', GRADOS)}")
    print(f"  head_units={cfg.get('head_units', 256)}  freeze_ratio={cfg.get('freeze_ratio', 0.65)}  "
          f"dropout={cfg.get('dropout')}")
    print("=" * 66)

    modelo = cargar_modelo(cfg)
    entrada = tensor_de_entrada(args.imagen)

    destino = MODELS_DIR / "condition_grader.onnx"
    print(f"\nExportando a {destino} (opset {args.opset})...")
    exportar(modelo, entrada, destino, args.opset)

    print("Verificando paridad numérica PyTorch vs. ONNX (onnxruntime, CPU)...")
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
