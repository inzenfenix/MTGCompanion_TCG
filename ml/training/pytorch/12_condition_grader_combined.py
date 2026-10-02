"""
MTG Card Scanner — Certamen 2, Stage 4 (ver ../../certamen_2/README.md, sección 9)
12_condition_grader_combined.py: reentrena el clasificador de condición
(PyTorch) sobre el dataset COMBINADO (sintético + fotos reales de Roboflow),
usando los mejores hiperparámetros encontrados por
`11_optuna_condition_grader.py` (val_accuracy=0.9525 sobre el split
sintético-solo).

Motivación: `10_condition_grader.py` y el estudio Optuna entrenaron sobre
`condition_dataset/index.csv` cuando todavía tenía solo las 4,000 imágenes
sintéticas (desgaste simulado con `synthetic_wear.py` sobre renders
limpios). Después se importaron 1,355 fotos reales de eBay (Roboflow, ver
`import_roboflow_condition_data.py`) al mismo `index.csv` — este script es
la primera corrida que efectivamente las usa. Pregunta que responde: ¿un
modelo que ve fotos reales durante el entrenamiento generaliza mejor a fotos
reales que uno que solo vio síntesis por OpenCV? Ver el hallazgo de la
sección 9 (Bastion of Remembrance predicho como HP con 63.8% confianza,
modelo entrenado 100% con datos sintéticos) — este es el experimento directo
para esa pregunta.

Split train/val sigue siendo por CARTA (no por imagen, mismo motivo que
`10_condition_grader.py`) — ahora "carta" incluye tanto card_id de Scryfall
(variantes sintéticas) como los ids sintéticos `roboflow_mtg_N`/
`roboflow_cross_N` (cada foto real es su propia "carta", no tiene variantes
hermanas, así que cae entera en train o en val, nunca se parte).

Modelo y resultados se guardan aparte de `10_condition_grader.py` /
`11_optuna_condition_grader.py` (sufijo `_combined`) para poder comparar los
tres directamente sin pisarse.

Uso:
    python 12_condition_grader_combined.py
    python 12_condition_grader_combined.py --epochs 20   # override manual
"""

import argparse
import csv
import datetime
import json
import pathlib
import random
import shutil

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn as nn
import torchvision.transforms as T
from PIL import Image
from sklearn.metrics import (
    accuracy_score, confusion_matrix, f1_score, precision_score, recall_score,
)
from torch.utils.data import DataLoader, Dataset

from src.condition_classifier import GRADOS, build_condition_grader

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
CERTAMEN2_DIR = SCRIPT_DIR.parent.parent / "certamen_2"
DATASET_INDEX = CERTAMEN2_DIR / "data" / "condition_dataset" / "index.csv"
OUTPUT_ROOT = SCRIPT_DIR.parent / "output" / "pytorch" / "condition_grader_combined"
MODELS_DIR = SCRIPT_DIR / "models"

IMG_SIZE = 224
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SEED = 42
VAL_SPLIT = 0.20

# Mejores hiperparámetros encontrados por 11_optuna_condition_grader.py
# (trial 13/20, val_accuracy=0.9525 sobre el split sintético-solo — ver
# output/pytorch/optuna_condition/latest/best_params.json).
BEST_PARAMS = {
    "learning_rate": 0.0006411408385833918,
    "weight_decay": 3.996038514374632e-05,
    "batch_size": 16,
    "head_units": 448,
    "dropout": 0.35,
    "optimizer": "adam",
    "freeze_ratio": 0.5,
}
EPOCHS = 15

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

TRANSFORM_TRAIN = T.Compose([
    T.Resize((IMG_SIZE + 32, IMG_SIZE + 32)),
    T.RandomCrop(IMG_SIZE),
    T.RandomHorizontalFlip(),
    T.ColorJitter(brightness=0.2, contrast=0.2),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])

TRANSFORM_VAL = T.Compose([
    T.Resize((IMG_SIZE, IMG_SIZE)),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])

torch.manual_seed(SEED)
random.seed(SEED)
np.random.seed(SEED)


class ConditionDataset(Dataset):
    """Dataset de condición: label = índice en GRADOS (NM=0 ... DMG=4)."""

    def __init__(self, samples: list, transform):
        self.samples = samples  # [(path, label_idx), ...]
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx: int):
        path, label = self.samples[idx]
        try:
            img = Image.open(path).convert("RGB")
        except Exception:
            img = Image.new("RGB", (IMG_SIZE, IMG_SIZE), color=(128, 128, 128))
        return self.transform(img), torch.tensor(label, dtype=torch.long)


def cargar_indice(index_path: pathlib.Path) -> dict:
    """Retorna {card_id: [(path, grado), ...]} agrupando las filas del index.csv por carta."""
    por_carta: dict = {}
    with open(index_path, encoding="utf-8") as f:
        for fila in csv.DictReader(f):
            por_carta.setdefault(fila["card_id"], []).append((fila["path"], fila["grado"]))
    return por_carta


def preparar_muestras(por_carta: dict, val_split: float, seed: int) -> tuple:
    """Split por carta (no por imagen) — ver docstring del módulo. Retorna (train, val)."""
    card_ids = list(por_carta.keys())
    rng = random.Random(seed)
    rng.shuffle(card_ids)

    split = int(len(card_ids) * (1 - val_split))
    train_ids, val_ids = card_ids[:split], card_ids[split:]

    grado_a_idx = {g: i for i, g in enumerate(GRADOS)}

    def expandir(ids):
        muestras = []
        for cid in ids:
            for path, grado in por_carta[cid]:
                muestras.append((path, grado_a_idx[grado]))
        rng.shuffle(muestras)
        return muestras

    return expandir(train_ids), expandir(val_ids)


def entrenar(model, optimizer, train_dl, val_dl, epochs: int, model_path: pathlib.Path) -> list:
    criterio = nn.CrossEntropyLoss()
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    mejor_val_acc = -1.0
    historial = []
    model_path.parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, epochs + 1):
        model.train()
        train_loss = 0.0
        for imgs, labels in train_dl:
            imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
            optimizer.zero_grad()
            loss = criterio(model(imgs), labels)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * len(imgs)
        train_loss /= len(train_dl.dataset)

        model.eval()
        val_correctos, val_total = 0, 0
        with torch.no_grad():
            for imgs, labels in val_dl:
                imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
                pred = model(imgs).argmax(dim=1)
                val_correctos += (pred == labels).sum().item()
                val_total += len(labels)
        val_acc = val_correctos / val_total if val_total else 0.0
        scheduler.step()

        historial.append({"epoch": epoch, "train_loss": train_loss, "val_accuracy": val_acc})

        marker = ""
        if val_acc > mejor_val_acc:
            mejor_val_acc = val_acc
            torch.save(model.state_dict(), model_path)
            marker = "  ← guardado"
        print(f"  Época {epoch:02d}/{epochs}  train_loss={train_loss:.4f}  val_accuracy={val_acc:.4f}{marker}")

    return historial


def evaluar(model, val_dl) -> tuple:
    model.eval()
    y_true, y_pred = [], []
    with torch.no_grad():
        for imgs, labels in val_dl:
            pred = model(imgs.to(DEVICE)).argmax(dim=1).cpu().numpy()
            y_true.extend(labels.numpy())
            y_pred.extend(pred)
    y_true, y_pred = np.array(y_true), np.array(y_pred)

    metricas = {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "f1_macro": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        "precision_macro": float(precision_score(y_true, y_pred, average="macro", zero_division=0)),
        "recall_macro": float(recall_score(y_true, y_pred, average="macro", zero_division=0)),
        "n_val": int(len(y_true)),
        "por_grado": {
            grado: {
                "precision": float(precision_score(y_true, y_pred, labels=[i], average="macro", zero_division=0)),
                "recall": float(recall_score(y_true, y_pred, labels=[i], average="macro", zero_division=0)),
                "f1": float(f1_score(y_true, y_pred, labels=[i], average="macro", zero_division=0)),
            }
            for i, grado in enumerate(GRADOS)
        },
    }
    return metricas, y_true, y_pred


def graficar_confusion(y_true, y_pred, out_path: pathlib.Path) -> None:
    cm = confusion_matrix(y_true, y_pred, labels=list(range(len(GRADOS))))
    fig, ax = plt.subplots(figsize=(6, 5))
    im = ax.imshow(cm, interpolation="nearest", cmap="Blues")
    plt.colorbar(im, ax=ax)
    ax.set(
        xticks=range(len(GRADOS)), yticks=range(len(GRADOS)),
        xticklabels=GRADOS, yticklabels=GRADOS,
        xlabel="Predicción", ylabel="Real",
        title="Confusion Matrix — Clasificador de Condición (PyTorch, dataset combinado)",
    )
    thresh = cm.max() / 2 if cm.max() else 0
    for i in range(len(GRADOS)):
        for j in range(len(GRADOS)):
            ax.text(j, i, f"{cm[i, j]:,}", ha="center", va="center",
                     color="white" if cm[i, j] > thresh else "black")
    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()


def graficar_loss(historial: list, out_path: pathlib.Path) -> None:
    epochs = [h["epoch"] for h in historial]
    fig, ax1 = plt.subplots(figsize=(8, 5))
    ax1.plot(epochs, [h["train_loss"] for h in historial], color="#E74C3C", lw=2, label="Train Loss")
    ax1.set_xlabel("Época")
    ax1.set_ylabel("Loss", color="#E74C3C")
    ax2 = ax1.twinx()
    ax2.plot(epochs, [h["val_accuracy"] for h in historial], color="#3498DB", lw=2, label="Val Accuracy")
    ax2.set_ylabel("Val Accuracy", color="#3498DB")
    ax2.set_ylim(0, 1.05)
    plt.title("Entrenamiento — Clasificador de Condición (PyTorch, dataset combinado)")
    fig.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Reentrena el clasificador de condición (Stage 4, PyTorch) "
                     "sobre el dataset combinado (sintético + real) con los "
                     "mejores hiperparámetros de Optuna."
    )
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--output-dir", default=None)
    args = parser.parse_args()

    if not DATASET_INDEX.exists():
        print(f"Error: no existe {DATASET_INDEX}.")
        raise SystemExit(1)

    print("=" * 70)
    print("  Stage 4 — Clasificador de Condición (PyTorch, dataset COMBINADO)")
    print(f"  Device        : {DEVICE}")
    print(f"  Grados        : {GRADOS}")
    print(f"  Hiperparámetros (de Optuna, trial 13/20):")
    for k, v in BEST_PARAMS.items():
        print(f"    {k:<15}: {v}")
    print("=" * 70)

    por_carta = cargar_indice(DATASET_INDEX)
    n_reales = sum(1 for cid in por_carta if cid.startswith("roboflow_"))
    print(f"\nCartas/fotos base en el dataset: {len(por_carta):,}  "
          f"({n_reales:,} fotos reales de Roboflow, {len(por_carta) - n_reales:,} cartas sintéticas)")

    train_samples, val_samples = preparar_muestras(por_carta, VAL_SPLIT, SEED)
    print(f"Train: {len(train_samples):,} imágenes  |  Val: {len(val_samples):,} imágenes  (split por carta)")

    batch_size = BEST_PARAMS["batch_size"]
    train_dl = DataLoader(ConditionDataset(train_samples, TRANSFORM_TRAIN), batch_size=batch_size,
                           shuffle=True, num_workers=4, pin_memory=(DEVICE == "cuda"))
    val_dl = DataLoader(ConditionDataset(val_samples, TRANSFORM_VAL), batch_size=batch_size,
                         shuffle=False, num_workers=4, pin_memory=(DEVICE == "cuda"))

    model, optimizer = build_condition_grader(
        freeze_ratio=BEST_PARAMS["freeze_ratio"],
        learning_rate=BEST_PARAMS["learning_rate"],
        weight_decay=BEST_PARAMS["weight_decay"],
        head_units=BEST_PARAMS["head_units"],
        dropout=BEST_PARAMS["dropout"],
        optimizer_name=BEST_PARAMS["optimizer"],
        device=DEVICE,
    )
    n_trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"Parámetros entrenables: {n_trainable / 1e6:.2f}M\n")

    model_path = MODELS_DIR / "condition_grader_combined.pth"
    historial = entrenar(model, optimizer, train_dl, val_dl, args.epochs, model_path)

    print("\nEvaluando mejor checkpoint...")
    model.load_state_dict(torch.load(model_path, map_location=DEVICE, weights_only=True))
    metricas, y_true, y_pred = evaluar(model, val_dl)

    print("\n── Resultados ─────────────────────────────────────")
    print(f"  Accuracy         : {metricas['accuracy']:.4f}")
    print(f"  F1 (macro)       : {metricas['f1_macro']:.4f}")
    print(f"  Precision (macro): {metricas['precision_macro']:.4f}")
    print(f"  Recall (macro)   : {metricas['recall_macro']:.4f}")
    for grado, m in metricas["por_grado"].items():
        print(f"    {grado:<4}: precision={m['precision']:.3f}  recall={m['recall']:.3f}  f1={m['f1']:.3f}")

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    run_dir = pathlib.Path(args.output_dir) if args.output_dir else OUTPUT_ROOT / timestamp
    run_dir.mkdir(parents=True, exist_ok=True)

    metricas["hiperparametros"] = BEST_PARAMS
    metricas["dataset"] = {
        "total_cartas_fotos": len(por_carta),
        "fotos_reales_roboflow": n_reales,
        "cartas_sinteticas": len(por_carta) - n_reales,
    }
    with open(run_dir / "metrics_condition_grader_combined.json", "w", encoding="utf-8") as f:
        json.dump(metricas, f, indent=2, ensure_ascii=False)
    graficar_confusion(y_true, y_pred, run_dir / "confusion_matrix.png")
    graficar_loss(historial, run_dir / "training_curve.png")

    cfg = {
        "grados": GRADOS,
        "model_path": "models/condition_grader_combined.pth",
        "freeze_ratio": model.freeze_ratio,
        "head_units": model.head_units,
        "img_size": IMG_SIZE,
    }
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    with open(MODELS_DIR / "condition_grader_combined_cfg.json", "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)

    if args.output_dir is None:
        latest = OUTPUT_ROOT / "latest"
        if latest.exists() or latest.is_symlink():
            if latest.is_symlink() or latest.is_file():
                latest.unlink()
            else:
                shutil.rmtree(latest)
        try:
            latest.symlink_to(run_dir.name, target_is_directory=True)
        except OSError:
            shutil.copytree(run_dir, latest)

    print(f"\nResultados: {run_dir}")
    print(f"Modelo    : {model_path}")


if __name__ == "__main__":
    main()
