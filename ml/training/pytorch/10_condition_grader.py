"""
MTG Card Scanner — Certamen 2, Stage 4 (ver ../../data-prep/README.md, sección 9)
10_condition_grader.py: clasificador de condición (NM/LP/MP/HP/DMG), PyTorch.

Corre en paralelo con Stage 1 (ambos consumen la misma carta ya localizada/
normalizada por ml/data-prep/card_preprocessing.py) — no necesita saber qué
carta es, solo en qué estado está. Entrena sobre el dataset sintético de
../../data-prep/data/condition_dataset/ (generado por
ml/data-prep/prepare_condition_dataset.py + synthetic_wear.py) — bootstrap con
desgaste simulado por OpenCV, no fotos reales etiquetadas por condición
todavía (ver README, sección 9, sobre los datasets reales identificados para
complementar esto más adelante).

Split train/val por CARTA, no por imagen: cada carta base genera 5 variantes
(una por grado), todas comparten el mismo arte/composición — si el split
fuera por imagen, el modelo podría ver la misma carta (en otro grado) en
train y val, y aprender a reconocer la carta en vez del desgaste. Agrupar por
card_id evita esa fuga.

Uso:
    python 10_condition_grader.py                       # dataset + defaults
    python 10_condition_grader.py --epochs 20 --n 500     # más épocas, menos cartas (iterar rápido)
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
DATA_PREP_DIR = SCRIPT_DIR.parent.parent / "data-prep"
DATASET_INDEX = DATA_PREP_DIR / "data" / "condition_dataset" / "index.csv"
OUTPUT_ROOT = SCRIPT_DIR.parent / "output" / "pytorch" / "condition_grader"
MODELS_DIR = SCRIPT_DIR / "models"

IMG_SIZE = 224
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SEED = 42
EPOCHS = 15
BATCH_SIZE = 32
VAL_SPLIT = 0.20

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


def preparar_muestras(por_carta: dict, n_cartas: int, val_split: float, seed: int) -> tuple:
    """Split por carta (no por imagen) — ver docstring del módulo. Retorna (train, val)."""
    card_ids = list(por_carta.keys())
    rng = random.Random(seed)
    rng.shuffle(card_ids)
    if n_cartas and n_cartas < len(card_ids):
        card_ids = card_ids[:n_cartas]

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
        title="Confusion Matrix — Clasificador de Condición (PyTorch)",
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
    plt.title("Entrenamiento — Clasificador de Condición (PyTorch)")
    fig.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Entrena el clasificador de condición (Stage 4, PyTorch).")
    parser.add_argument("--n", type=int, default=0, help="Cartas base a usar (0 = todas las del dataset).")
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--output-dir", default=None)
    args = parser.parse_args()

    if not DATASET_INDEX.exists():
        print(f"Error: no existe {DATASET_INDEX}.")
        print("Corré ml/data-prep/prepare_condition_dataset.py primero.")
        raise SystemExit(1)

    print("=" * 62)
    print("  Stage 4 — Clasificador de Condición (PyTorch, EfficientNet_b0)")
    print(f"  Device : {DEVICE}")
    print(f"  Grados : {GRADOS}")
    print("=" * 62)

    por_carta = cargar_indice(DATASET_INDEX)
    print(f"\nCartas base en el dataset: {len(por_carta):,}")

    train_samples, val_samples = preparar_muestras(por_carta, args.n, VAL_SPLIT, SEED)
    print(f"Train: {len(train_samples):,} imágenes  |  Val: {len(val_samples):,} imágenes  (split por carta)")

    train_dl = DataLoader(ConditionDataset(train_samples, TRANSFORM_TRAIN), batch_size=BATCH_SIZE,
                           shuffle=True, num_workers=4, pin_memory=(DEVICE == "cuda"))
    val_dl = DataLoader(ConditionDataset(val_samples, TRANSFORM_VAL), batch_size=BATCH_SIZE,
                         shuffle=False, num_workers=4, pin_memory=(DEVICE == "cuda"))

    model, optimizer = build_condition_grader(device=DEVICE)
    n_trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"Parámetros entrenables: {n_trainable / 1e6:.2f}M\n")

    model_path = MODELS_DIR / "condition_grader.pth"
    historial = entrenar(model, optimizer, train_dl, val_dl, args.epochs, model_path)

    print("\nEvaluando mejor checkpoint...")
    model.load_state_dict(torch.load(model_path, map_location=DEVICE, weights_only=True))
    metricas, y_true, y_pred = evaluar(model, val_dl)

    print("\n── Resultados ─────────────────────────────────────")
    print(f"  Accuracy       : {metricas['accuracy']:.4f}")
    print(f"  F1 (macro)     : {metricas['f1_macro']:.4f}")
    print(f"  Precision (macro): {metricas['precision_macro']:.4f}")
    print(f"  Recall (macro)   : {metricas['recall_macro']:.4f}")
    for grado, m in metricas["por_grado"].items():
        print(f"    {grado:<4}: precision={m['precision']:.3f}  recall={m['recall']:.3f}  f1={m['f1']:.3f}")

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    run_dir = pathlib.Path(args.output_dir) if args.output_dir else OUTPUT_ROOT / timestamp
    run_dir.mkdir(parents=True, exist_ok=True)

    with open(run_dir / "metrics_condition_grader.json", "w", encoding="utf-8") as f:
        json.dump(metricas, f, indent=2, ensure_ascii=False)
    graficar_confusion(y_true, y_pred, run_dir / "confusion_matrix.png")
    graficar_loss(historial, run_dir / "training_curve.png")

    cfg = {
        "grados": GRADOS,
        "model_path": "models/condition_grader.pth",
        "freeze_ratio": model.freeze_ratio,
        "head_units": model.head_units,
        "img_size": IMG_SIZE,
    }
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    with open(MODELS_DIR / "condition_grader_cfg.json", "w", encoding="utf-8") as f:
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
