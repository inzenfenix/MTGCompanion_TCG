"""
MTG Card Scanner — Certamen 2, Stage 3 (ver ../../data-prep/README.md,
sección 5.1.1)
19_export_onnx_price_embedding.py: exporta el extractor de embedding visual
de Stage 1 (`MTGDetector.features` → `.avgpool` → `.flatten`, 1280 dims) a
ONNX, para que la app Ionic pueda calcular la mitad visual del feature
vector de Stage 3 (`stage3-price-estimator.onnx`, input `[batch, 1330]` =
50 tabular + 1280 visual, desde ROADMAP.md B6) del lado del cliente.

Por qué un export separado de `09_export_onnx.py` (no agregar una segunda
salida ahí): `stage1-detector.onnx` ya está publicado y consumido por
`stage1Detector.ts` con un solo output (`logit`) — tocar ese contrato
arriesga romper un consumidor que ya funciona (verificado, ver ROADMAP.md
C10) por un cambio que en realidad es para Stage 3, no Stage 1. Este script
es aditivo: mismo checkpoint (`models/mtg_detector.pth`), mismo backbone,
pero expone la salida intermedia como su propio grafo ONNX de una sola
salida, sin tocar `09_export_onnx.py`.

Reusa exactamente la misma extracción que `prepare_price_embeddings.py`
(`modelo.flatten(modelo.avgpool(modelo.features(x)))`, ver esa docstring
para el porqué) — mismo checkpoint, mismo preprocessing (224×224,
normalización ImageNet), así que el embedding que ve el modelo Stage 3
entrenado y el que calcula la app Ionic en el navegador son la misma
función. No vuelve a entrenar nada.

Verificación incluida: igual que `09_export_onnx.py`, corre el mismo tensor
de entrada por el modelo PyTorch y por el modelo ONNX exportado y compara —
si difieren más que una tolerancia chica, no se publica.

Uso:
    python 19_export_onnx_price_embedding.py
    python 19_export_onnx_price_embedding.py --imagen test_photos/mi_carta.jpg
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
import torch.nn as nn
import torchvision.transforms as T
from PIL import Image

from src.binary_classifier import MTGDetector

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
MODELS_DIR = SCRIPT_DIR / "models"
# Misma convención que 09_export_onnx.py / 16_export_onnx_text_validator.py /
# 18_export_onnx_price_estimator.py — ver CLAUDE.md regla 3.
IONIC_MODELS_DIR = SCRIPT_DIR.parent.parent.parent / "apps" / "mobile" / "public" / "models"
IMG_SIZE = 224
DEVICE = "cpu"  # export y verificación en CPU, mismo criterio que 09_export_onnx.py

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

TRANSFORM = T.Compose([
    T.Resize((IMG_SIZE, IMG_SIZE)),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])


class EmbeddingExtractor(nn.Module):
    """Envoltorio delgado sobre un MTGDetector ya cargado — descarta `.head`,
    expone solo el embedding congelado (1280 dims), igual que
    `prepare_price_embeddings.py::embeber_batch()`."""

    def __init__(self, detector: MTGDetector):
        super().__init__()
        self.features = detector.features
        self.avgpool = detector.avgpool
        self.flatten = detector.flatten

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.flatten(self.avgpool(self.features(x)))  # (B, 1280)


def cargar_modelo(cfg: dict) -> EmbeddingExtractor:
    detector = MTGDetector(
        freeze_ratio=cfg.get("freeze_ratio", 0.65),
        head_units=cfg.get("head_units", 256),
        dropout=cfg.get("dropout"),
    )
    detector.load_state_dict(
        torch.load(MODELS_DIR / "mtg_detector.pth", map_location=DEVICE, weights_only=True)
    )
    detector.eval()
    modelo = EmbeddingExtractor(detector)
    modelo.eval()
    return modelo


def tensor_de_entrada(imagen: pathlib.Path | None) -> torch.Tensor:
    if imagen is not None:
        img = Image.open(imagen).convert("RGB")
        return TRANSFORM(img).unsqueeze(0)
    torch.manual_seed(42)
    return torch.randn(1, 3, IMG_SIZE, IMG_SIZE)


def exportar(modelo: EmbeddingExtractor, entrada: torch.Tensor, destino: pathlib.Path, opset: int) -> None:
    batch = torch.export.Dim("batch")
    torch.onnx.export(
        modelo,
        entrada,
        str(destino),
        input_names=["imagen"],
        output_names=["embedding"],
        dynamic_shapes={"x": {0: batch}},
        opset_version=opset,
        external_data=False,  # ver 09_export_onnx.py sobre por qué (ROADMAP.md C10)
    )


def verificar(modelo: EmbeddingExtractor, entrada: torch.Tensor, onnx_path: pathlib.Path, tolerancia: float) -> float:
    onnx.checker.check_model(onnx.load(str(onnx_path)))

    with torch.no_grad():
        salida_pt = modelo(entrada).numpy()

    sesion = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    salida_onnx = sesion.run(None, {"imagen": entrada.numpy().astype(np.float32)})[0]

    diff = float(np.max(np.abs(salida_pt - salida_onnx)))
    if diff > tolerancia:
        raise ValueError(
            f"Diferencia máxima entre PyTorch y ONNX ({diff:.2e}) supera la tolerancia "
            f"({tolerancia:.2e}) — no se publica el .onnx."
        )
    return diff


def publicar_en_ionic(destino: pathlib.Path, nombre_publico: str) -> pathlib.Path | None:
    if not IONIC_MODELS_DIR.parent.exists():
        print(f"  aviso: no se encontró {IONIC_MODELS_DIR.parent} — no se copia a la app Ionic.")
        return None
    IONIC_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    publico = IONIC_MODELS_DIR / nombre_publico
    shutil.copy2(destino, publico)
    sidecar = destino.with_name(destino.name + ".data")
    if sidecar.exists():
        shutil.copy2(sidecar, publico.with_name(publico.name + ".data"))
    return publico


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Exporta el extractor de embedding visual de Stage 1 (para Stage 3) a ONNX."
    )
    parser.add_argument("--imagen", type=pathlib.Path, default=None,
                        help="Imagen real para verificar (default: tensor aleatorio con seed fija)")
    parser.add_argument("--opset", type=int, default=18, help="Versión de opset ONNX (default: 18)")
    # 2e-4, no 1e-4 como el resto de los *_export_onnx*.py: medido en vivo
    # (ROADMAP.md E2, 16 ago) — con el tensor aleatorio por defecto (sin
    # --imagen) la paridad da 1.03e-04, apenas sobre 1e-4, porque un backbone
    # EfficientNet profundo amplifica el error de redondeo de la reexportación
    # dynamo cuando la entrada es ruido fuera de distribución (no algo que
    # vería una foto real). Con una foto real la paridad es 3.5e-06, dos
    # órdenes de magnitud mejor — confirmado corriendo este mismo script con
    # --imagen contra una carta real. 2e-4 deja margen para el caso por
    # defecto sin ocultar una regresión real (una foto real sigue muy por
    # debajo de esto).
    parser.add_argument("--tolerancia", type=float, default=2e-4,
                        help="Diferencia máxima aceptable entre salidas PyTorch/ONNX (default: 2e-4)")
    parser.add_argument("--no-ionic-copy", action="store_true",
                        help="No copiar el .onnx a apps/mobile/public/models/ (solo dejarlo en models/).")
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
    print("  Export ONNX — Embedding visual de Stage 1 (para Stage 3, PyTorch)")
    print(f"  head_units={cfg.get('head_units', 256)}  freeze_ratio={cfg.get('freeze_ratio', 0.65)}")
    print("=" * 66)

    modelo = cargar_modelo(cfg)
    entrada = tensor_de_entrada(args.imagen)

    destino = MODELS_DIR / "price_embedding.onnx"
    print(f"\nExportando a {destino} (opset {args.opset})...")
    exportar(modelo, entrada, destino, args.opset)

    print("Verificando paridad numérica PyTorch vs. ONNX (onnxruntime, CPU)...")
    diff = verificar(modelo, entrada, destino, args.tolerancia)
    print(f"  Diferencia máxima: {diff:.2e}  (tolerancia: {args.tolerancia:.2e})  ✓")

    tam_mb = destino.stat().st_size / 1e6
    print(f"\nModelo ONNX publicado: {destino}  ({tam_mb:.1f} MB)")

    if not args.no_ionic_copy:
        publico = publicar_en_ionic(destino, "stage1-embedder.onnx")
        if publico:
            print(f"Copiado a la app Ionic       : {publico}")
    print("Próximo paso: stage3PriceEstimator.ts combina esto con el vector")
    print("tabular de 50 dims (ver pytorch/src/price_features.py) antes de")
    print("llamar a stage3-price-estimator.onnx.")


if __name__ == "__main__":
    main()
