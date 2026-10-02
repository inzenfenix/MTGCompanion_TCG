"""
MTG Card Scanner — Certamen 2, Stage 3 (ver ../../data-prep/README.md)
13_price_estimator.py: estimador de precio "de verdad" (no el baseline
tabular), TensorFlow. Espejo de ../pytorch/15_price_estimator.py.

Entrena sobre concat(x_tab, x_vis) — ver ml/data-prep/README.md, sección 5.1.1:
x_tab son 48 dims tabulares idénticas a PyTorch (src/price_features.py),
x_vis es el embedding visual de 576 dims del backbone YA fine-tuneado de
Stage 1, completamente congelado y precalculado una sola vez por
ml/data-prep/prepare_price_dataset.py + prepare_price_embeddings.py — este
script no toca imágenes ni el backbone, solo lee los artefactos ya cacheados
en ml/data-prep/data/price_dataset/.

Split train/val/test fijo por card_id, compartido entre frameworks — ver
split.json (arma ml/data-prep/prepare_price_dataset.py) — mismo motivo que
split_por_carta() en 12_text_validator.py (CLAUDE.md regla 5).

Target: log1p(prices.usd) — métricas en escala log y en USD (MAE, Median AE,
RMSE, R²), comparables directo contra el piso ya medido del baseline (MAE
$2.59, R²(USD) 0.191, R²(log-USD) 0.521).

No hay flag --device: TensorFlow no tiene ruta de GPU en esta máquina fuera
de Docker (CLAUDE.md regla 6) — entrena en CPU siempre, y el modelo es chico
así que es rápido igual.

Uso:
    python 13_price_estimator.py
    python 13_price_estimator.py --epochs 60 --hidden-units 128
"""

import argparse
import csv
import datetime
import json
import pathlib
import shutil

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import tensorflow as tf
from sklearn.metrics import mean_absolute_error, mean_squared_error, median_absolute_error, r2_score

from src.price_features import (
    COLORES,
    N_TAB_FEATURES,
    TIPOS_PRIMARIOS,
    build_tabular_vector,
    escalar_numericos,
)
from src.price_regressor import build_price_regressor

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
DATA_PREP_DIR = SCRIPT_DIR.parent.parent / "data-prep"
PRICE_DATASET_DIR = DATA_PREP_DIR / "data" / "price_dataset"
CARDS_CSV = PRICE_DATASET_DIR / "cards.csv"
SPLIT_JSON = PRICE_DATASET_DIR / "split.json"
SCALER_JSON = PRICE_DATASET_DIR / "tabular_scaler.json"
EMBEDDINGS_NPY = PRICE_DATASET_DIR / "tensorflow_visual_embeddings.npy"
EMBEDDINGS_IDS_JSON = PRICE_DATASET_DIR / "tensorflow_card_ids.json"
OUTPUT_ROOT = SCRIPT_DIR.parent / "output" / "tensorflow" / "price_estimator"
MODELS_DIR = SCRIPT_DIR / "models"

SEED = 42
EPOCHS = 40
BATCH_SIZE = 64

_CAMPOS_NUMERICOS_CSV = (
    ["cmc", "n_colores", "es_incoloro", "es_legendaria", "n_frame_effects",
     "tiene_foil", "tiene_etched", "anio", "antiguedad_anios",
     "edhrec_rank_conocido", "edhrec_rank_log"]  # ROADMAP.md B6, 15 ago
    + [f"color_{c}" for c in COLORES]
    + [f"tipo_{t.lower()}" for t in TIPOS_PRIMARIOS]
)


def cargar_cards_csv(path: pathlib.Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def fila_a_raw(fila: dict) -> dict:
    raw = dict(fila)
    for campo in _CAMPOS_NUMERICOS_CSV:
        raw[campo] = float(fila[campo])
    return raw


def construir_features(filas: list[dict], embeddings_por_id: dict, medias: list, desvios: list) -> tuple:
    X, y = [], []
    for fila in filas:
        x_tab = build_tabular_vector(fila_a_raw(fila))
        x_tab = escalar_numericos(x_tab, medias, desvios)
        x_vis = embeddings_por_id[fila["card_id"]]
        X.append(np.concatenate([np.array(x_tab, dtype=np.float32), x_vis]))
        y.append(np.log1p(float(fila["usd"])))
    return np.stack(X).astype(np.float32), np.array(y, dtype=np.float32)


def entrenar(model: tf.keras.Model, X_train, y_train, X_val, y_val, epochs: int, batch_size: int,
             model_path: pathlib.Path, base_lr: float) -> list:
    model_path.parent.mkdir(parents=True, exist_ok=True)
    checkpoint = tf.keras.callbacks.ModelCheckpoint(
        filepath=str(model_path), monitor="val_loss", mode="min", save_best_only=True, verbose=0,
    )
    # Mismo perfil de cosine annealing que
    # torch.optim.lr_scheduler.CosineAnnealingLR(T_max=epochs) del lado
    # PyTorch — ver 12_text_validator.py.
    scheduler = tf.keras.callbacks.LearningRateScheduler(
        lambda epoch, lr: float(base_lr * 0.5 * (1 + np.cos(np.pi * epoch / epochs)))
    )
    history = model.fit(
        X_train, y_train, validation_data=(X_val, y_val),
        epochs=epochs, batch_size=batch_size,
        callbacks=[checkpoint, scheduler], shuffle=True, verbose=2,
    )
    return [
        {"epoch": i + 1, "train_loss": tl, "val_loss": vl}
        for i, (tl, vl) in enumerate(zip(history.history["loss"], history.history["val_loss"]))
    ]


def evaluar(model: tf.keras.Model, X, y_true_log) -> tuple:
    y_pred_log = model.predict(X, verbose=0).reshape(-1)
    y_true_log = np.asarray(y_true_log)
    y_true_usd = np.expm1(y_true_log)
    y_pred_usd = np.clip(np.expm1(y_pred_log), 0, None)

    metricas = {
        "n": int(len(y_true_log)),
        "log_space": {
            "mae": float(mean_absolute_error(y_true_log, y_pred_log)),
            "rmse": float(np.sqrt(mean_squared_error(y_true_log, y_pred_log))),
            "r2": float(r2_score(y_true_log, y_pred_log)),
        },
        "usd_space": {
            "mae": float(mean_absolute_error(y_true_usd, y_pred_usd)),
            "median_ae": float(median_absolute_error(y_true_usd, y_pred_usd)),
            "rmse": float(np.sqrt(mean_squared_error(y_true_usd, y_pred_usd))),
            "r2": float(r2_score(y_true_usd, y_pred_usd)),
        },
    }
    return metricas, y_true_usd, y_pred_usd


def graficar_pred_vs_actual(y_true_usd: np.ndarray, y_pred_usd: np.ndarray, out_path: pathlib.Path) -> None:
    plt.figure(figsize=(7, 7))
    plt.scatter(y_true_usd, y_pred_usd, alpha=0.25, s=10, color="#55A868")
    lim = max(y_true_usd.max(), y_pred_usd.max(), 1.0)
    plt.plot([0, lim], [0, lim], "--", color="gray", linewidth=1)
    plt.xscale("log")
    plt.yscale("log")
    plt.xlabel("Precio real (USD, log)")
    plt.ylabel("Precio predicho (USD, log)")
    plt.title("Stage 3 — Estimador de precio (TensorFlow): predicho vs. real")
    plt.tight_layout()
    plt.savefig(out_path, dpi=130)
    plt.close()


def graficar_loss(historial: list, out_path: pathlib.Path) -> None:
    epochs = [h["epoch"] for h in historial]
    plt.figure(figsize=(8, 5))
    plt.plot(epochs, [h["train_loss"] for h in historial], color="#E74C3C", lw=2, label="Train MSE (log-space)")
    plt.plot(epochs, [h["val_loss"] for h in historial], color="#3498DB", lw=2, label="Val MSE (log-space)")
    plt.xlabel("Época")
    plt.ylabel("MSE")
    plt.legend()
    plt.title("Entrenamiento — Estimador de Precio (TensorFlow)")
    plt.tight_layout()
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
    parser = argparse.ArgumentParser(description="Entrena el estimador de precio (Stage 3, TensorFlow).")
    parser.add_argument("--epochs", type=int, default=EPOCHS)
    parser.add_argument("--hidden-units", type=int, default=256)
    parser.add_argument("--dropout", type=float, default=0.3)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--optimizer", default="adamw", choices=["adam", "adamw", "sgd"])
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--output-dir", default=None)
    args = parser.parse_args()

    faltantes = [
        (CARDS_CSV, "ml/data-prep/prepare_price_dataset.py"),
        (SPLIT_JSON, "ml/data-prep/prepare_price_dataset.py"),
        (SCALER_JSON, "ml/data-prep/prepare_price_dataset.py"),
        (EMBEDDINGS_NPY, "tensorFlow/prepare_price_embeddings.py"),
        (EMBEDDINGS_IDS_JSON, "tensorFlow/prepare_price_embeddings.py"),
    ]
    for path, script in faltantes:
        if not path.exists():
            print(f"Error: no existe {path}.")
            print(f"Corré {script} primero.")
            raise SystemExit(1)

    tf.keras.utils.set_random_seed(SEED)

    print("=" * 62)
    print("  Stage 3 — Estimador de Precio (TensorFlow, tabular + visual)")
    print("=" * 62)

    filas = cargar_cards_csv(CARDS_CSV)
    filas_por_id = {f["card_id"]: f for f in filas}

    with open(SPLIT_JSON, encoding="utf-8") as f:
        split = json.load(f)
    with open(SCALER_JSON, encoding="utf-8") as f:
        scaler = json.load(f)
    medias, desvios = scaler["mean"], scaler["std"]

    embeddings = np.load(EMBEDDINGS_NPY)
    with open(EMBEDDINGS_IDS_JSON, encoding="utf-8") as f:
        embedding_ids = json.load(f)
    embeddings_por_id = {cid: embeddings[i] for i, cid in enumerate(embedding_ids)}

    def filtrar(ids: list[str]) -> list[dict]:
        return [filas_por_id[cid] for cid in ids if cid in filas_por_id and cid in embeddings_por_id]

    train_filas = filtrar(split["train"])
    val_filas = filtrar(split["val"])
    test_filas = filtrar(split["test"])
    print(f"\nTrain: {len(train_filas):,}  Val: {len(val_filas):,}  Test: {len(test_filas):,}  (split por carta)")

    X_train, y_train = construir_features(train_filas, embeddings_por_id, medias, desvios)
    X_val, y_val = construir_features(val_filas, embeddings_por_id, medias, desvios)
    X_test, y_test = construir_features(test_filas, embeddings_por_id, medias, desvios)

    input_dim = X_train.shape[1]
    print(f"input_dim = {input_dim}  ({N_TAB_FEATURES} tabular + {input_dim - N_TAB_FEATURES} visual)")

    model = build_price_regressor(
        input_dim=input_dim, hidden_units=args.hidden_units, dropout=args.dropout,
        learning_rate=args.lr, weight_decay=args.weight_decay,
        optimizer_name=args.optimizer,
    )
    n_trainable = sum(int(np.prod(w.shape)) for w in model.trainable_weights)
    print(f"Parámetros entrenables: {n_trainable / 1e6:.2f}M\n")

    model_path = MODELS_DIR / "price_regressor.keras"
    historial = entrenar(model, X_train, y_train, X_val, y_val, args.epochs, args.batch_size, model_path, args.lr)

    print("\nEvaluando mejor checkpoint (test set)...")
    modelo_evaluado = tf.keras.models.load_model(model_path)
    metricas, y_true_usd, y_pred_usd = evaluar(modelo_evaluado, X_test, y_test)

    print("\n── Resultados (test set) ─────────────────────────")
    print(f"  MAE (USD)     : ${metricas['usd_space']['mae']:.2f}")
    print(f"  Median AE(USD): ${metricas['usd_space']['median_ae']:.2f}")
    print(f"  RMSE (USD)    : ${metricas['usd_space']['rmse']:.2f}")
    print(f"  R² (USD)      : {metricas['usd_space']['r2']:.3f}")
    print(f"  R² (log-USD)  : {metricas['log_space']['r2']:.3f}  (más representativo dado el sesgo del precio)")

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    run_dir = pathlib.Path(args.output_dir) if args.output_dir else OUTPUT_ROOT / timestamp
    run_dir.mkdir(parents=True, exist_ok=True)

    with open(run_dir / "metrics_price_estimator.json", "w", encoding="utf-8") as f:
        json.dump(metricas, f, indent=2, ensure_ascii=False)
    graficar_pred_vs_actual(y_true_usd, y_pred_usd, run_dir / "pred_vs_actual.png")
    graficar_loss(historial, run_dir / "training_curve.png")

    cfg = {
        "input_dim": model.input_dim,
        "n_tab_features": N_TAB_FEATURES,
        "hidden_units": model.hidden_units,
        "dropout": model.dropout_p,
        "model_path": "models/price_regressor.keras",
    }
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    with open(MODELS_DIR / "price_regressor_cfg.json", "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)

    if args.output_dir is None:
        _actualizar_latest(OUTPUT_ROOT, run_dir)

    print(f"\nResultados: {run_dir}")
    print(f"Modelo    : {model_path}")


if __name__ == "__main__":
    main()
