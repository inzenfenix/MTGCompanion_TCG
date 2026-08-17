"""
MTG Card Scanner — Certamen 2, Stage 4 (ver ../../certamen_2/README.md, sección 9)
11_condition_grader_combined.py: reentrena el clasificador de condición
(TensorFlow) sobre el dataset COMBINADO (sintético + fotos reales de
Roboflow), usando los mejores hiperparámetros encontrados por
`10_optuna_condition_grader.py` (val_accuracy=0.6375 sobre el split
sintético-solo — bastante más bajo que el 0.9525 de PyTorch en el mismo
punto, ver certamen_1/RESULTADOS.md § Stage 4; ese gap ya está registrado,
no es nuevo).

Espejo directo de pytorch/12_condition_grader_combined.py — mismo
motivo (CLAUDE.md's pipeline table decía explícitamente "TensorFlow has no
combined-checkpoint equivalent yet", ROADMAP.md ítem I20 punto 2), mismo
dataset (`../../certamen_2/data/condition_dataset/index.csv`, ya con las
1,355 fotos reales de Roboflow importadas junto a las sintéticas), mismo
split por CARTA (no por imagen — "carta" acá incluye tanto card_id de
Scryfall como los ids sintéticos `roboflow_mtg_N`/`roboflow_cross_N`, cada
foto real es su propia "carta").

Modelo y resultados se guardan aparte de `09_condition_grader.py` /
`10_optuna_condition_grader.py` (sufijo `_combined`) para poder comparar
los tres directamente sin pisarse — igual que el lado PyTorch.

Uso:
    python 11_condition_grader_combined.py
    python 11_condition_grader_combined.py --epochs 20   # override manual
"""

import argparse
import csv
import datetime
import json
import pathlib
import random
import shutil

import numpy as np
import tensorflow as tf
from sklearn.metrics import (
    accuracy_score, confusion_matrix, f1_score, precision_score, recall_score,
)

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from src.config import IMG_SIZE
from src.condition_classifier import GRADOS, build_condition_grader

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
CERTAMEN2_DIR = SCRIPT_DIR.parent.parent / "certamen_2"
DATASET_INDEX = CERTAMEN2_DIR / "data" / "condition_dataset" / "index.csv"
OUTPUT_ROOT = SCRIPT_DIR.parent / "output" / "tensorflow" / "condition_grader_combined"
MODELS_DIR = SCRIPT_DIR / "models"

SEED = 42
VAL_SPLIT = 0.20

# Mejores hiperparámetros encontrados por 10_optuna_condition_grader.py
# (trial 12/20, val_accuracy=0.6375 sobre el split sintético-solo — ver
# output/tensorflow/optuna_condition/latest/best_params.json).
BEST_PARAMS = {
    "learning_rate": 0.0006233843477099821,
    "weight_decay": 1.1089509545987041e-06,
    "batch_size": 16,
    "head_units": 512,
    "dropout": 0.5,
    "optimizer": "adam",
    "freeze_ratio": 0.5,
}
EPOCHS = 15

AUGMENT = tf.keras.Sequential([
    tf.keras.layers.RandomFlip("horizontal"),
    tf.keras.layers.RandomRotation(10 / 360),
    tf.keras.layers.RandomContrast(0.2),
    tf.keras.layers.RandomBrightness(0.2, value_range=(0, 255)),
    tf.keras.layers.RandomCrop(IMG_SIZE[0], IMG_SIZE[1]),
])


def _decode_resize(path: tf.Tensor, label: tf.Tensor, size: tuple) -> tuple:
    img = tf.io.read_file(path)
    img = tf.io.decode_jpeg(img, channels=3)
    img = tf.image.resize(img, size)
    return img, label


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
        muestras = [(path, grado_a_idx[grado]) for cid in ids for path, grado in por_carta[cid]]
        rng.shuffle(muestras)
        return muestras

    return expandir(train_ids), expandir(val_ids)


def build_dataset(samples: list, training: bool, batch_size: int) -> tf.data.Dataset:
    paths = [s[0] for s in samples]
    labels = [int(s[1]) for s in samples]
    preprocess = tf.keras.applications.mobilenet_v3.preprocess_input

    ds = tf.data.Dataset.from_tensor_slices((paths, labels))
    if training:
        ds = ds.shuffle(len(samples), seed=SEED, reshuffle_each_iteration=True)
        grande = (IMG_SIZE[0] + 32, IMG_SIZE[1] + 32)
        ds = ds.map(lambda p, l: _decode_resize(p, l, grande), num_parallel_calls=tf.data.AUTOTUNE)
        ds = ds.map(lambda img, l: (AUGMENT(img, training=True), l), num_parallel_calls=tf.data.AUTOTUNE)
    else:
        ds = ds.map(lambda p, l: _decode_resize(p, l, IMG_SIZE), num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.map(lambda img, l: (preprocess(img), l), num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.batch(batch_size).prefetch(tf.data.AUTOTUNE)
    return ds


def entrenar(model: tf.keras.Model, train_ds, val_ds, epochs: int, model_path: pathlib.Path) -> list:
    model_path.parent.mkdir(parents=True, exist_ok=True)
    checkpoint = tf.keras.callbacks.ModelCheckpoint(
        filepath=str(model_path), monitor="val_accuracy", mode="max", save_best_only=True, verbose=0,
    )
    scheduler = tf.keras.callbacks.LearningRateScheduler(
        lambda epoch, lr: float(BEST_PARAMS["learning_rate"] * 0.5 * (1 + np.cos(np.pi * epoch / epochs)))
    )
    history = model.fit(
        train_ds, validation_data=val_ds, epochs=epochs,
        callbacks=[checkpoint, scheduler], shuffle=False, verbose=2,
    )
    return [
        {"epoch": i + 1, "train_loss": tl, "val_accuracy": va}
        for i, (tl, va) in enumerate(zip(history.history["loss"], history.history["val_accuracy"]))
    ]


def evaluar(model: tf.keras.Model, val_ds, y_true: np.ndarray) -> tuple:
    y_prob = model.predict(val_ds, verbose=0)
    y_pred = y_prob.argmax(axis=1)

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
    return metricas, y_pred


def graficar_confusion(y_true, y_pred, out_path: pathlib.Path) -> None:
    cm = confusion_matrix(y_true, y_pred, labels=list(range(len(GRADOS))))
    fig, ax = plt.subplots(figsize=(6, 5))
    im = ax.imshow(cm, interpolation="nearest", cmap="Blues")
    plt.colorbar(im, ax=ax)
    ax.set(
        xticks=range(len(GRADOS)), yticks=range(len(GRADOS)),
        xticklabels=GRADOS, yticklabels=GRADOS,
        xlabel="Predicción", ylabel="Real",
        title="Confusion Matrix — Clasificador de Condición (TensorFlow, dataset combinado)",
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
    plt.title("Entrenamiento — Clasificador de Condición (TensorFlow, dataset combinado)")
    fig.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Reentrena el clasificador de condición (Stage 4, TensorFlow) "
                     "sobre el dataset combinado (sintético + real) con los "
                     "mejores hiperparámetros de Optuna."
    )
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--output-dir", default=None)
    args = parser.parse_args()

    if not DATASET_INDEX.exists():
        print(f"Error: no existe {DATASET_INDEX}.")
        raise SystemExit(1)

    tf.keras.utils.set_random_seed(SEED)

    print("=" * 70)
    print("  Stage 4 — Clasificador de Condición (TensorFlow, dataset COMBINADO)")
    print(f"  Grados        : {GRADOS}")
    print(f"  Hiperparámetros (de Optuna, trial 12/20):")
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
    train_ds = build_dataset(train_samples, training=True, batch_size=batch_size)
    val_ds = build_dataset(val_samples, training=False, batch_size=batch_size)
    y_true = np.array([label for _, label in val_samples], dtype=int)

    model = build_condition_grader(
        freeze_ratio=BEST_PARAMS["freeze_ratio"],
        learning_rate=BEST_PARAMS["learning_rate"],
        weight_decay=BEST_PARAMS["weight_decay"],
        head_units=BEST_PARAMS["head_units"],
        dropout=BEST_PARAMS["dropout"],
        optimizer_name=BEST_PARAMS["optimizer"],
    )
    n_trainable = sum(int(np.prod(w.shape)) for w in model.trainable_weights)
    print(f"Parámetros entrenables: {n_trainable / 1e6:.2f}M\n")

    model_path = MODELS_DIR / "condition_grader_combined.keras"
    historial = entrenar(model, train_ds, val_ds, args.epochs, model_path)

    print("\nEvaluando mejor checkpoint...")
    model = tf.keras.models.load_model(model_path)
    metricas, y_pred = evaluar(model, val_ds, y_true)

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
        "model_path": "models/condition_grader_combined.keras",
        "freeze_ratio": BEST_PARAMS["freeze_ratio"],
        "head_units": BEST_PARAMS["head_units"],
        "img_size": list(IMG_SIZE),
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
