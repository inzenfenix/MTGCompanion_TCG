"""
MTG Card Scanner — Certamen 2, Stage 3 (ver ../../certamen_2/README.md)
15_price_estimator.py: estimador de precio "de verdad" (no el baseline
tabular de certamen_2/price_estimator_baseline.py), PyTorch.

Entrena sobre concat(x_tab, x_vis) — ver certamen_2/README.md, sección 5.1.1
("Diseño del feature vector combinado"): x_tab son 48 dims tabulares
idénticas a TensorFlow (src/price_features.py), x_vis es el embedding visual
de 1280 dims del backbone YA fine-tuneado de Stage 1, completamente
congelado y precalculado una sola vez por certamen_2/prepare_price_dataset.py
+ prepare_price_embeddings.py — este script no toca imágenes ni el backbone,
solo lee los artefactos ya cacheados en certamen_2/data/price_dataset/.

Split train/val/test fijo por card_id, compartido entre frameworks — ver
split.json (arma certamen_2/prepare_price_dataset.py). Mismo motivo que
split_por_carta() en 14_text_validator.py (CLAUDE.md regla 5), aunque acá
cada carta aporta una sola fila (no hay riesgo de leakage por fila
duplicada) — se usa igual para que ambos frameworks entrenen/evalúen sobre
exactamente las mismas cartas.

Target: log1p(prices.usd), igual que price_estimator_baseline.py — métricas
reportadas en escala log y en USD (MAE, Median AE, RMSE, R²) para comparar
directo contra el piso ya medido del baseline (MAE $2.59, R²(USD) 0.191,
R²(log-USD) 0.521).

Uso:
    python 15_price_estimator.py
    python 15_price_estimator.py --epochs 60 --hidden-units 128
    python 15_price_estimator.py --device cpu
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
import torch
import torch.nn as nn
from sklearn.metrics import mean_absolute_error, mean_squared_error, median_absolute_error, r2_score
from torch.utils.data import DataLoader, TensorDataset

from src.price_features import (
    COLORES,
    N_TAB_FEATURES,
    TIPOS_PRIMARIOS,
    build_tabular_vector,
    escalar_numericos,
)
from src.price_regressor import build_price_regressor

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
CERTAMEN2_DIR = SCRIPT_DIR.parent.parent / "certamen_2"
PRICE_DATASET_DIR = CERTAMEN2_DIR / "data" / "price_dataset"
CARDS_CSV = PRICE_DATASET_DIR / "cards.csv"
SPLIT_JSON = PRICE_DATASET_DIR / "split.json"
SCALER_JSON = PRICE_DATASET_DIR / "tabular_scaler.json"
EMBEDDINGS_NPY = PRICE_DATASET_DIR / "pytorch_visual_embeddings.npy"
EMBEDDINGS_IDS_JSON = PRICE_DATASET_DIR / "pytorch_card_ids.json"
OUTPUT_ROOT = SCRIPT_DIR.parent / "output" / "pytorch" / "price_estimator"
MODELS_DIR = SCRIPT_DIR / "models"

# Mismo default que el resto del pipeline (Stage 1/2/4) — ver nota completa
# sobre el bug ROCm/MIOpen puntual en 14_text_validator.py (CLAUDE.md regla
# 1). Si te pasa acá también, corré con --device cpu.
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SEED = 42
EPOCHS = 40
BATCH_SIZE = 64

torch.manual_seed(SEED)
np.random.seed(SEED)

# Nombres de columna crudos en cards.csv que llegan como str y hay que
# reconvertir a número antes de build_tabular_vector() — todo excepto
# card_id/usd/rarity/set_type/frame/border_color (que se quedan como str).
_CAMPOS_NUMERICOS_CSV = (
    ["cmc", "n_colores", "es_incoloro", "es_legendaria", "n_frame_effects",
     "tiene_foil", "tiene_etched", "anio", "antiguedad_anios"]
    + [f"color_{c}" for c in COLORES]
    + [f"tipo_{t.lower()}" for t in TIPOS_PRIMARIOS]
)


def cargar_cards_csv(path: pathlib.Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def fila_a_raw(fila: dict) -> dict:
    """csv.DictReader da todo como str — reconvierte los campos numéricos
    antes de pasarle la fila a build_tabular_vector()."""
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


def entrenar(model, optimizer, train_dl, val_dl, epochs: int, model_path: pathlib.Path) -> list:
    criterio = nn.MSELoss()
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    mejor_val_loss = float("inf")
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
        val_loss = 0.0
        with torch.no_grad():
            for x, y in val_dl:
                pred = model(x.to(DEVICE))
                val_loss += criterio(pred, y.to(DEVICE)).item() * len(x)
        val_loss /= len(val_dl.dataset)
        scheduler.step()

        historial.append({"epoch": epoch, "train_loss": train_loss, "val_loss": val_loss})

        marker = ""
        if val_loss < mejor_val_loss:
            mejor_val_loss = val_loss
            torch.save(model.state_dict(), model_path)
            marker = "  ← guardado"
        print(f"  Época {epoch:02d}/{epochs}  train_mse={train_loss:.4f}  val_mse={val_loss:.4f}{marker}")

    return historial


def evaluar(model, dl) -> tuple:
    model.eval()
    y_true_log, y_pred_log = [], []
    with torch.no_grad():
        for x, y in dl:
            pred = model(x.to(DEVICE))
            y_pred_log.extend(pred.cpu().numpy())
            y_true_log.extend(y.numpy())
    y_true_log, y_pred_log = np.array(y_true_log), np.array(y_pred_log)
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
    plt.title("Stage 3 — Estimador de precio (PyTorch): predicho vs. real")
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
    plt.title("Entrenamiento — Estimador de Precio (PyTorch)")
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
    parser = argparse.ArgumentParser(description="Entrena el estimador de precio (Stage 3, PyTorch).")
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

    faltantes = [
        (CARDS_CSV, "certamen_2/prepare_price_dataset.py"),
        (SPLIT_JSON, "certamen_2/prepare_price_dataset.py"),
        (SCALER_JSON, "certamen_2/prepare_price_dataset.py"),
        (EMBEDDINGS_NPY, "pytorch/prepare_price_embeddings.py"),
        (EMBEDDINGS_IDS_JSON, "pytorch/prepare_price_embeddings.py"),
    ]
    for path, script in faltantes:
        if not path.exists():
            print(f"Error: no existe {path}.")
            print(f"Corré {script} primero.")
            raise SystemExit(1)

    print("=" * 62)
    print("  Stage 3 — Estimador de Precio (PyTorch, tabular + visual)")
    print(f"  Device : {DEVICE}")
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

    train_dl = DataLoader(
        TensorDataset(torch.from_numpy(X_train), torch.from_numpy(y_train)),
        batch_size=BATCH_SIZE, shuffle=True,
    )
    val_dl = DataLoader(
        TensorDataset(torch.from_numpy(X_val), torch.from_numpy(y_val)),
        batch_size=BATCH_SIZE, shuffle=False,
    )
    test_dl = DataLoader(
        TensorDataset(torch.from_numpy(X_test), torch.from_numpy(y_test)),
        batch_size=BATCH_SIZE, shuffle=False,
    )

    model, optimizer = build_price_regressor(
        input_dim=input_dim, hidden_units=args.hidden_units, dropout=args.dropout,
        learning_rate=args.lr, weight_decay=args.weight_decay,
        optimizer_name=args.optimizer, device=DEVICE,
    )
    n_trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"Parámetros entrenables: {n_trainable / 1e6:.2f}M\n")

    model_path = MODELS_DIR / "price_regressor.pth"
    historial = entrenar(model, optimizer, train_dl, val_dl, args.epochs, model_path)

    print("\nEvaluando mejor checkpoint (test set)...")
    model.load_state_dict(torch.load(model_path, map_location=DEVICE, weights_only=True))
    metricas, y_true_usd, y_pred_usd = evaluar(model, test_dl)

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
        "model_path": "models/price_regressor.pth",
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
