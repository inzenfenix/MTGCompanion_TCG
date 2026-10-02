"""
MTG Card Scanner — Certamen 2, Stage 2 (ver ../../data-prep/README.md)
14_text_validator.py: validador de texto "de verdad" (no el baseline difflib), PyTorch.

Entrena sobre el dataset de pares (ocr_text, texto_referencia, label) que arma
ml/data-prep/prepare_text_validator_dataset.py — separado del entrenamiento por
el mismo motivo que Stage 4 separa prepare_condition_dataset.py: el OCR
(tesseract, lento) corre una sola vez, no en cada iteración de arquitectura.

Split train/val por CARTA (card_id), no por fila — cada carta aporta 2 filas
(un par positivo contra sí misma, uno negativo contra otra carta al azar) y
comparten el mismo ocr_text; si el split fuera por fila, el mismo ocr_text
podría aparecer en train y val. Mismo criterio que 10_condition_grader.py.

Uso:
    python 14_text_validator.py                      # dataset + defaults
    python 14_text_validator.py --epochs 30 --hidden-units 128
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
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score, roc_curve
from torch.utils.data import DataLoader, TensorDataset

from src.text_matcher import N_FEATURES, build_text_matcher, build_vectorizer

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
DATA_PREP_DIR = SCRIPT_DIR.parent.parent / "data-prep"
DATASET_INDEX = DATA_PREP_DIR / "data" / "text_pairs" / "index.csv"
OUTPUT_ROOT = SCRIPT_DIR.parent / "output" / "pytorch" / "text_validator"
MODELS_DIR = SCRIPT_DIR / "models"

# Mismo default que el resto del pipeline (Stage 1/4): GPU si está disponible.
# Nota: en algunas GPU AMD (ROCm/MIOpen) un nn.Linear(2048, 256) — el tamaño
# de la primera capa de TextMatcher — puede crashear (segfault) por un bug de
# selección de kernel específico de esa forma, no de este script. Si te pasa,
# corré con --device cpu (el modelo es chico, ~0.5M parámetros — entrena en
# segundos igual en CPU). No se desactiva la GPU por default: sería castigar
# a cualquiera con una GPU que no tenga este bug puntual (NVIDIA, u otra AMD).
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SEED = 42
EPOCHS = 20
BATCH_SIZE = 64
VAL_SPLIT = 0.20

torch.manual_seed(SEED)
random.seed(SEED)
np.random.seed(SEED)


def cargar_dataset(index_path: pathlib.Path) -> list[dict]:
    with open(index_path, encoding="utf-8") as f:
        filas = list(csv.DictReader(f))
    for fila in filas:
        fila["ocr_text"] = fila["ocr_text"] or ""
        fila["ref_text"] = fila["ref_text"] or ""
        fila["label"] = int(fila["label"])
    return filas


def split_por_carta(filas: list[dict], val_split: float, seed: int) -> tuple[list[dict], list[dict]]:
    """Split por card_id — ver docstring del módulo. Retorna (train, val)."""
    card_ids = list(dict.fromkeys(f["card_id"] for f in filas))  # únicos, orden estable
    rng = random.Random(seed)
    rng.shuffle(card_ids)

    split = int(len(card_ids) * (1 - val_split))
    train_ids, val_ids = set(card_ids[:split]), set(card_ids[split:])

    train_filas = [f for f in filas if f["card_id"] in train_ids]
    val_filas = [f for f in filas if f["card_id"] in val_ids]
    return train_filas, val_filas


def construir_features(filas: list[dict], vectorizador) -> tuple[np.ndarray, np.ndarray]:
    """Vectoriza en batch (mucho más rápido que par_a_features fila por fila) — ver src/text_matcher.py."""
    v_ocr = vectorizador.transform([f["ocr_text"] for f in filas]).toarray().astype(np.float32)
    v_ref = vectorizador.transform([f["ref_text"] for f in filas]).toarray().astype(np.float32)
    X = np.concatenate([v_ocr, v_ref, np.abs(v_ocr - v_ref), v_ocr * v_ref], axis=1)
    y = np.array([f["label"] for f in filas], dtype=np.float32)
    return X, y


def entrenar(model, optimizer, train_dl, val_dl, epochs: int, model_path: pathlib.Path) -> list:
    criterio = nn.BCEWithLogitsLoss()
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    mejor_val_auc = -1.0
    historial = []
    model_path.parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, epochs + 1):
        model.train()
        train_loss = 0.0
        for x, y in train_dl:
            x, y = x.to(DEVICE), y.to(DEVICE)
            optimizer.zero_grad()
            loss = criterio(model(x), y)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * len(x)
        train_loss /= len(train_dl.dataset)

        model.eval()
        y_true, y_score = [], []
        with torch.no_grad():
            for x, y in val_dl:
                logits = model(x.to(DEVICE))
                y_score.extend(torch.sigmoid(logits).cpu().numpy())
                y_true.extend(y.numpy())
        val_auc = roc_auc_score(y_true, y_score) if len(set(y_true)) > 1 else 0.0
        scheduler.step()

        historial.append({"epoch": epoch, "train_loss": train_loss, "val_auc": val_auc})

        marker = ""
        if val_auc > mejor_val_auc:
            mejor_val_auc = val_auc
            torch.save(model.state_dict(), model_path)
            marker = "  ← guardado"
        print(f"  Época {epoch:02d}/{epochs}  train_loss={train_loss:.4f}  val_auc={val_auc:.4f}{marker}")

    return historial


def evaluar(model, val_dl) -> tuple:
    model.eval()
    y_true, y_score = [], []
    with torch.no_grad():
        for x, y in val_dl:
            logits = model(x.to(DEVICE))
            y_score.extend(torch.sigmoid(logits).cpu().numpy())
            y_true.extend(y.numpy())
    y_true, y_score = np.array(y_true), np.array(y_score)

    auc = float(roc_auc_score(y_true, y_score)) if len(set(y_true)) > 1 else 0.0
    fpr, tpr, thresholds = roc_curve(y_true, y_score)
    youden = tpr - fpr
    umbral_optimo = float(thresholds[np.argmax(youden)])
    y_pred = (y_score >= umbral_optimo).astype(int)
    accuracy = float(accuracy_score(y_true, y_pred))
    f1 = float(f1_score(y_true, y_pred)) if len(set(y_true)) > 1 else 0.0

    metricas = {
        "roc_auc": auc,
        "umbral_optimo": umbral_optimo,
        "accuracy_en_umbral_optimo": accuracy,
        "f1_en_umbral_optimo": f1,
        "n_val": int(len(y_true)),
    }
    return metricas, fpr, tpr, y_true, y_score, umbral_optimo


def graficar_roc(fpr, tpr, auc: float, y_true, y_score, umbral: float, out_path: pathlib.Path) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    axes[0].plot(fpr, tpr, color="#4C72B0")
    axes[0].plot([0, 1], [0, 1], "--", color="gray")
    axes[0].set_xlabel("FPR")
    axes[0].set_ylabel("TPR")
    axes[0].set_title(f"ROC — Stage 2 (PyTorch, AUC={auc:.3f})")

    axes[1].hist(y_score[y_true == 1], bins=30, alpha=0.6, label="positivo (misma carta)", color="#55A868")
    axes[1].hist(y_score[y_true == 0], bins=30, alpha=0.6, label="negativo (otra carta)", color="#C44E52")
    axes[1].axvline(umbral, color="black", linestyle="--", label="umbral óptimo")
    axes[1].set_xlabel("Score del validador")
    axes[1].set_title("Distribución de scores")
    axes[1].legend(fontsize=8)

    plt.tight_layout()
    plt.savefig(out_path, dpi=130)
    plt.close()


def graficar_loss(historial: list, out_path: pathlib.Path) -> None:
    epochs = [h["epoch"] for h in historial]
    fig, ax1 = plt.subplots(figsize=(8, 5))
    ax1.plot(epochs, [h["train_loss"] for h in historial], color="#E74C3C", lw=2, label="Train Loss")
    ax1.set_xlabel("Época")
    ax1.set_ylabel("Loss", color="#E74C3C")
    ax2 = ax1.twinx()
    ax2.plot(epochs, [h["val_auc"] for h in historial], color="#3498DB", lw=2, label="Val ROC-AUC")
    ax2.set_ylabel("Val ROC-AUC", color="#3498DB")
    ax2.set_ylim(0, 1.05)
    plt.title("Entrenamiento — Validador de Texto (PyTorch)")
    fig.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()


def _actualizar_latest(output_root: pathlib.Path, run_dir: pathlib.Path) -> None:
    latest = output_root / "latest"
    if latest.exists() or latest.is_symlink():
        if latest.is_symlink() or latest.is_file():
            latest.unlink()
        else:
            shutil.rmtree(latest)
    try:
        latest.symlink_to(run_dir.name, target_is_directory=True)
    except OSError:
        shutil.copytree(run_dir, latest)


def main() -> None:
    parser = argparse.ArgumentParser(description="Entrena el validador de texto (Stage 2, PyTorch).")
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--hidden-units", type=int, default=256)
    parser.add_argument("--dropout", type=float, default=0.3)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--optimizer", default="adamw", choices=["adam", "adamw", "sgd"])
    parser.add_argument("--output-dir", default=None)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"],
                         help="'auto' (default) usa GPU si torch.cuda.is_available(). Ver nota sobre ROCm arriba.")
    args = parser.parse_args()

    global DEVICE
    if args.device != "auto":
        DEVICE = args.device

    if not DATASET_INDEX.exists():
        print(f"Error: no existe {DATASET_INDEX}.")
        print("Corré ml/data-prep/prepare_text_validator_dataset.py primero.")
        raise SystemExit(1)

    print("=" * 62)
    print("  Stage 2 — Validador de Texto (PyTorch, hashing + MLP)")
    print(f"  Device : {DEVICE}")
    print("=" * 62)

    filas = cargar_dataset(DATASET_INDEX)
    n_cartas = len({f["card_id"] for f in filas})
    print(f"\nPares en el dataset: {len(filas):,}  ({n_cartas:,} cartas base)")

    train_filas, val_filas = split_por_carta(filas, VAL_SPLIT, SEED)
    print(f"Train: {len(train_filas):,} pares  |  Val: {len(val_filas):,} pares  (split por carta)")

    vectorizador = build_vectorizer()
    X_train, y_train = construir_features(train_filas, vectorizador)
    X_val, y_val = construir_features(val_filas, vectorizador)

    train_dl = DataLoader(
        TensorDataset(torch.from_numpy(X_train), torch.from_numpy(y_train)),
        batch_size=BATCH_SIZE, shuffle=True,
    )
    val_dl = DataLoader(
        TensorDataset(torch.from_numpy(X_val), torch.from_numpy(y_val)),
        batch_size=BATCH_SIZE, shuffle=False,
    )

    model, optimizer = build_text_matcher(
        hidden_units=args.hidden_units, dropout=args.dropout,
        learning_rate=args.lr, weight_decay=args.weight_decay,
        optimizer_name=args.optimizer, device=DEVICE,
    )
    n_trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"Parámetros entrenables: {n_trainable / 1e6:.2f}M\n")

    model_path = MODELS_DIR / "text_matcher.pth"
    historial = entrenar(model, optimizer, train_dl, val_dl, args.epochs, model_path)

    print("\nEvaluando mejor checkpoint...")
    model.load_state_dict(torch.load(model_path, map_location=DEVICE, weights_only=True))
    metricas, fpr, tpr, y_true, y_score, umbral = evaluar(model, val_dl)

    print("\n── Resultados ─────────────────────────────────────")
    print(f"  ROC-AUC                : {metricas['roc_auc']:.4f}")
    print(f"  Umbral óptimo (Youden)  : {metricas['umbral_optimo']:.4f}")
    print(f"  Accuracy en ese umbral  : {metricas['accuracy_en_umbral_optimo']:.4f}")
    print(f"  F1 en ese umbral        : {metricas['f1_en_umbral_optimo']:.4f}")

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    run_dir = pathlib.Path(args.output_dir) if args.output_dir else OUTPUT_ROOT / timestamp
    run_dir.mkdir(parents=True, exist_ok=True)

    with open(run_dir / "metrics_text_validator.json", "w", encoding="utf-8") as f:
        json.dump(metricas, f, indent=2, ensure_ascii=False)
    graficar_roc(fpr, tpr, metricas["roc_auc"], y_true, y_score, umbral, run_dir / "roc_y_distribucion.png")
    graficar_loss(historial, run_dir / "training_curve.png")

    cfg = {
        "n_features": N_FEATURES,
        "input_dim": model.input_dim,
        "hidden_units": model.hidden_units,
        "dropout": model.dropout_p,
        "umbral_optimo": metricas["umbral_optimo"],
        "model_path": "models/text_matcher.pth",
    }
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    with open(MODELS_DIR / "text_matcher_cfg.json", "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)

    if args.output_dir is None:
        _actualizar_latest(OUTPUT_ROOT, run_dir)

    print(f"\nResultados: {run_dir}")
    print(f"Modelo    : {model_path}")


if __name__ == "__main__":
    main()
