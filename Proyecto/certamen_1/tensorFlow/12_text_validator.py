"""
MTG Card Scanner — Certamen 2, Stage 2 (ver ../../certamen_2/README.md)
12_text_validator.py: validador de texto "de verdad" (no el baseline difflib), TensorFlow.

Espejo de pytorch/14_text_validator.py — mismo dataset de pares (ocr_text,
texto_referencia, label) que arma certamen_2/prepare_text_validator_dataset.py,
mismo split por CARTA (card_id, no por fila — ver docstring del script
PyTorch), mismas features (src/text_matcher.py, HashingVectorizer idéntico al
lado PyTorch — CLAUDE.md regla 4), mismas métricas (ROC-AUC, umbral óptimo de
Youden, accuracy en ese umbral) para que la comparación cross-framework sea
justa.

No hay flag --device: TensorFlow no tiene ruta de GPU en esta máquina fuera
de Docker (CLAUDE.md regla 6) — entrena en CPU siempre, y el modelo es chico
(~0.5M parámetros) así que es rápido igual.

Uso:
    python 12_text_validator.py                      # dataset + defaults
    python 12_text_validator.py --epochs 30 --hidden-units 128
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
import tensorflow as tf
from sklearn.metrics import accuracy_score, roc_auc_score, roc_curve

from src.text_matcher import N_FEATURES, build_text_matcher, build_vectorizer

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
CERTAMEN2_DIR = SCRIPT_DIR.parent.parent / "certamen_2"
DATASET_INDEX = CERTAMEN2_DIR / "data" / "text_pairs" / "index.csv"
OUTPUT_ROOT = SCRIPT_DIR.parent / "output" / "tensorflow" / "text_validator"
MODELS_DIR = SCRIPT_DIR / "models"

SEED = 42
EPOCHS = 20
BATCH_SIZE = 64
VAL_SPLIT = 0.20


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
    """Vectoriza en batch — ver src/text_matcher.py y pytorch/14_text_validator.py."""
    v_ocr = vectorizador.transform([f["ocr_text"] for f in filas]).toarray().astype(np.float32)
    v_ref = vectorizador.transform([f["ref_text"] for f in filas]).toarray().astype(np.float32)
    X = np.concatenate([v_ocr, v_ref, np.abs(v_ocr - v_ref), v_ocr * v_ref], axis=1)
    y = np.array([f["label"] for f in filas], dtype=np.float32)
    return X, y


def entrenar(model: tf.keras.Model, X_train, y_train, X_val, y_val, epochs: int, batch_size: int,
             model_path: pathlib.Path, base_lr: float) -> list:
    model_path.parent.mkdir(parents=True, exist_ok=True)
    checkpoint = tf.keras.callbacks.ModelCheckpoint(
        filepath=str(model_path), monitor="val_auc", mode="max", save_best_only=True, verbose=0,
    )
    # Cosine annealing sobre base_lr (el --lr pasado), no sobre el lr ya
    # decaído de la época anterior — mismo perfil que
    # torch.optim.lr_scheduler.CosineAnnealingLR(T_max=epochs) del lado PyTorch.
    scheduler = tf.keras.callbacks.LearningRateScheduler(
        lambda epoch, lr: float(base_lr * 0.5 * (1 + np.cos(np.pi * epoch / epochs)))
    )
    history = model.fit(
        X_train, y_train, validation_data=(X_val, y_val),
        epochs=epochs, batch_size=batch_size,
        callbacks=[checkpoint, scheduler], shuffle=True, verbose=2,
    )
    return [
        {"epoch": i + 1, "train_loss": tl, "val_auc": va}
        for i, (tl, va) in enumerate(zip(history.history["loss"], history.history["val_auc"]))
    ]


def evaluar(model: tf.keras.Model, X_val, y_val) -> tuple:
    logits = model.predict(X_val, verbose=0).reshape(-1)
    y_score = tf.sigmoid(logits).numpy()
    y_true = y_val

    auc = float(roc_auc_score(y_true, y_score)) if len(set(y_true)) > 1 else 0.0
    fpr, tpr, thresholds = roc_curve(y_true, y_score)
    youden = tpr - fpr
    umbral_optimo = float(thresholds[np.argmax(youden)])
    accuracy = float(accuracy_score(y_true, (y_score >= umbral_optimo).astype(int)))

    metricas = {
        "roc_auc": auc,
        "umbral_optimo": umbral_optimo,
        "accuracy_en_umbral_optimo": accuracy,
        "n_val": int(len(y_true)),
    }
    return metricas, fpr, tpr, y_true, y_score, umbral_optimo


def graficar_roc(fpr, tpr, auc: float, y_true, y_score, umbral: float, out_path: pathlib.Path) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    axes[0].plot(fpr, tpr, color="#4C72B0")
    axes[0].plot([0, 1], [0, 1], "--", color="gray")
    axes[0].set_xlabel("FPR")
    axes[0].set_ylabel("TPR")
    axes[0].set_title(f"ROC — Stage 2 (TensorFlow, AUC={auc:.3f})")

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
    plt.title("Entrenamiento — Validador de Texto (TensorFlow)")
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
    parser = argparse.ArgumentParser(description="Entrena el validador de texto (Stage 2, TensorFlow).")
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--hidden-units", type=int, default=256)
    parser.add_argument("--dropout", type=float, default=0.3)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--optimizer", default="adamw", choices=["adam", "adamw", "sgd"])
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--dataset", type=pathlib.Path, default=DATASET_INDEX,
                         help="Override del index.csv (usado por el smoke test con datos sintéticos).")
    parser.add_argument("--output-dir", default=None)
    args = parser.parse_args()

    if not args.dataset.exists():
        print(f"Error: no existe {args.dataset}.")
        print("Corré certamen_2/prepare_text_validator_dataset.py primero.")
        raise SystemExit(1)

    tf.keras.utils.set_random_seed(SEED)

    print("=" * 62)
    print("  Stage 2 — Validador de Texto (TensorFlow, hashing + MLP)")
    print("=" * 62)

    filas = cargar_dataset(args.dataset)
    n_cartas = len({f["card_id"] for f in filas})
    print(f"\nPares en el dataset: {len(filas):,}  ({n_cartas:,} cartas base)")

    train_filas, val_filas = split_por_carta(filas, VAL_SPLIT, SEED)
    print(f"Train: {len(train_filas):,} pares  |  Val: {len(val_filas):,} pares  (split por carta)")

    vectorizador = build_vectorizer()
    X_train, y_train = construir_features(train_filas, vectorizador)
    X_val, y_val = construir_features(val_filas, vectorizador)

    model = build_text_matcher(
        hidden_units=args.hidden_units, dropout=args.dropout,
        learning_rate=args.lr, weight_decay=args.weight_decay,
        optimizer_name=args.optimizer,
    )
    n_trainable = sum(int(np.prod(w.shape)) for w in model.trainable_weights)
    print(f"Parámetros entrenables: {n_trainable / 1e6:.2f}M\n")

    model_path = MODELS_DIR / "text_matcher.keras"
    historial = entrenar(model, X_train, y_train, X_val, y_val, args.epochs, args.batch_size, model_path, args.lr)

    print("\nEvaluando mejor checkpoint...")
    # Nota: no reasignamos `model` acá (a diferencia del lado PyTorch, que
    # recarga pesos sobre el mismo objeto) — tf.keras.models.load_model
    # devuelve un objeto nuevo, así que perdería los atributos custom
    # (input_dim/hidden_units/dropout_p) que usa el cfg más abajo. Cargamos
    # en una variable aparte solo para evaluar el checkpoint publicado.
    modelo_evaluado = tf.keras.models.load_model(model_path)
    metricas, fpr, tpr, y_true, y_score, umbral = evaluar(modelo_evaluado, X_val, y_val)

    print("\n── Resultados ─────────────────────────────────────")
    print(f"  ROC-AUC                : {metricas['roc_auc']:.4f}")
    print(f"  Umbral óptimo (Youden)  : {metricas['umbral_optimo']:.4f}")
    print(f"  Accuracy en ese umbral  : {metricas['accuracy_en_umbral_optimo']:.4f}")

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
        "model_path": "models/text_matcher.keras",
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
