"""
Optimiza con Optuna el estimador de precio (Stage 3, PyTorch).

Mismo patrón que 15_optuna_text_validator.py (mismo formato de artefactos:
study.db, run_config.json, trials.csv, best_params.json, optuna_historia.png,
optuna_importancia.png, final_metrics.json) aplicado a 15_price_estimator.py.

A diferencia de Stage 2, acá el objective es de regresión: se minimiza
val_loss (MSE en escala log1p(price), la misma que reporta el checkpoint
"mejor" de 15_price_estimator.py) en vez de maximizar ROC-AUC. Igual que
Stage 2, el featurizado (tabular + embedding visual congelado) ya viene
precalculado en disco (ml/data-prep/prepare_price_dataset.py +
prepare_price_embeddings.py) y se arma una sola vez antes de abrir el
estudio, no en cada trial.

Ejemplos:
    python 17_optuna_price_estimator.py
    python 17_optuna_price_estimator.py --trials 2 --trial-epochs 3 --no-final-train
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import random
import sys
from types import ModuleType
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import numpy as np
import optuna
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from src.price_regressor import build_price_regressor
from src.optuna_support import (
    create_or_resume_run,
    remaining_trials_to_run,
    save_study_artifacts,
    storage_url,
    update_latest,
)

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
OUTPUT_ROOT = SCRIPT_DIR.parent / "output" / "pytorch" / "optuna_price_estimator"
MODELS_DIR = SCRIPT_DIR / "models"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Mismo criterio de search space que 15_optuna_text_validator.py.
SEARCH_SPACE = {
    "learning_rate": {"low": 1e-5, "high": 1e-2, "log": True},
    "weight_decay": {"low": 1e-6, "high": 1e-2, "log": True},
    "batch_size": [16, 32, 64, 128],
    "hidden_units": {"low": 64, "high": 512, "step": 64},
    "dropout": {"low": 0.0, "high": 0.5, "step": 0.05},
    "optimizer": ["adam", "adamw", "sgd"],
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Optuna para el estimador de precio PyTorch (Stage 3)")
    parser.add_argument("--trials", type=int, default=20, help="Total objetivo de trials del estudio (default: 20)")
    parser.add_argument("--trial-epochs", type=int, default=10, help="Máximo de épocas por trial (default: 10)")
    parser.add_argument("--final-epochs", type=int, default=40, help="Épocas del reentrenamiento final (default: 40)")
    parser.add_argument("--timeout-hours", type=float, help="Límite total de optimización en horas")
    parser.add_argument("--study-name", default="price_estimator_pytorch", help="Nombre persistente del estudio")
    parser.add_argument("--resume-dir", type=pathlib.Path, help="Directorio Optuna previo que contiene study.db")
    parser.add_argument("--seed", type=int, default=42, help="Semilla reproducible (default: 42)")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"],
                         help="'auto' (default) usa GPU si torch.cuda.is_available(). Ver nota en 15_price_estimator.py.")
    parser.add_argument("--no-final-train", action="store_true", help="No reentrenar ni reemplazar el modelo final")
    return parser.parse_args(argv)


def validate_args(args: argparse.Namespace) -> None:
    for name in ("trials", "trial_epochs", "final_epochs"):
        if getattr(args, name) <= 0:
            raise ValueError(f"--{name.replace('_', '-')} debe ser mayor que cero")
    if args.timeout_hours is not None and args.timeout_hours <= 0:
        raise ValueError("--timeout-hours debe ser mayor que cero")


def load_training_module() -> ModuleType:
    """Carga 15_price_estimator.py para reutilizar dataset/features/evaluación."""
    path = SCRIPT_DIR / "15_price_estimator.py"
    spec = importlib.util.spec_from_file_location("price_estimator_training", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"No se pudo cargar el pipeline existente: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        if sys.modules.get(spec.name) is module:
            del sys.modules[spec.name]
        raise
    return module


def suggest_parameters(trial: optuna.Trial) -> dict[str, Any]:
    return {
        "learning_rate": trial.suggest_float("learning_rate", 1e-5, 1e-2, log=True),
        "weight_decay": trial.suggest_float("weight_decay", 1e-6, 1e-2, log=True),
        "batch_size": trial.suggest_categorical("batch_size", [16, 32, 64, 128]),
        "hidden_units": trial.suggest_int("hidden_units", 64, 512, step=64),
        "dropout": trial.suggest_float("dropout", 0.0, 0.5, step=0.05),
        "optimizer": trial.suggest_categorical("optimizer", ["adam", "adamw", "sgd"]),
    }


def _liberar_cuda() -> None:
    if DEVICE == "cuda":
        torch.cuda.empty_cache()


def make_objective(
    X_train: np.ndarray, y_train: np.ndarray,
    X_val: np.ndarray, y_val: np.ndarray,
    trial_epochs: int,
    seed: int = 42,
):
    """Crea el objective — minimiza val_loss (MSE, log-space). El featurizado
    ya viene hecho (ver docstring del módulo)."""

    def objective(trial: optuna.Trial) -> float:
        torch.manual_seed(seed)
        params = suggest_parameters(trial)
        model, optimizer = None, None
        try:
            train_dl = DataLoader(
                TensorDataset(torch.from_numpy(X_train), torch.from_numpy(y_train)),
                batch_size=params["batch_size"], shuffle=True,
            )
            val_dl = DataLoader(
                TensorDataset(torch.from_numpy(X_val), torch.from_numpy(y_val)),
                batch_size=params["batch_size"], shuffle=False,
            )
            model, optimizer = build_price_regressor(
                input_dim=X_train.shape[1],
                hidden_units=params["hidden_units"],
                dropout=params["dropout"],
                learning_rate=params["learning_rate"],
                weight_decay=params["weight_decay"],
                optimizer_name=params["optimizer"],
                device=DEVICE,
            )
            criterio = nn.MSELoss()
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=trial_epochs)

            best_val_loss = float("inf")
            for epoch in range(1, trial_epochs + 1):
                model.train()
                for x, y in train_dl:
                    x, y = x.to(DEVICE), y.to(DEVICE)
                    optimizer.zero_grad()
                    loss = criterio(model(x), y)
                    loss.backward()
                    optimizer.step()
                scheduler.step()

                model.eval()
                val_loss = 0.0
                with torch.no_grad():
                    for x, y in val_dl:
                        pred = model(x.to(DEVICE))
                        val_loss += criterio(pred, y.to(DEVICE)).item() * len(x)
                val_loss /= len(val_dl.dataset)
                best_val_loss = min(best_val_loss, val_loss)

                trial.report(val_loss, epoch)
                if trial.should_prune():
                    raise optuna.TrialPruned()

            if not np.isfinite(best_val_loss):
                raise FloatingPointError("val_loss no finita")
            return best_val_loss
        finally:
            del model, optimizer
            _liberar_cuda()

    return objective


def train_final_model(
    best_params: dict[str, Any],
    training_module: ModuleType,
    X_train: np.ndarray, y_train: np.ndarray,
    X_val: np.ndarray, y_val: np.ndarray,
    X_test: np.ndarray, y_test: np.ndarray,
    epochs: int,
    run_dir: pathlib.Path,
    seed: int,
) -> dict[str, Any]:
    """Reentrena el ganador y publica el modelo solo tras validar el checkpoint."""
    torch.manual_seed(seed)
    batch_size = int(best_params["batch_size"])
    train_dl = DataLoader(
        TensorDataset(torch.from_numpy(X_train), torch.from_numpy(y_train)),
        batch_size=batch_size, shuffle=True,
    )
    val_dl = DataLoader(
        TensorDataset(torch.from_numpy(X_val), torch.from_numpy(y_val)),
        batch_size=batch_size, shuffle=False,
    )
    test_dl = DataLoader(
        TensorDataset(torch.from_numpy(X_test), torch.from_numpy(y_test)),
        batch_size=batch_size, shuffle=False,
    )

    arch_kwargs = dict(hidden_units=int(best_params["hidden_units"]), dropout=float(best_params["dropout"]))
    model, optimizer = build_price_regressor(
        input_dim=X_train.shape[1],
        **arch_kwargs,
        learning_rate=float(best_params["learning_rate"]),
        weight_decay=float(best_params["weight_decay"]),
        optimizer_name=str(best_params["optimizer"]),
        device=DEVICE,
    )

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    temporary_model = MODELS_DIR / "price_regressor.optuna_tmp.pth"
    if temporary_model.exists():
        temporary_model.unlink()

    historial = training_module.entrenar(model, optimizer, train_dl, val_dl, epochs, temporary_model)
    (run_dir / "final_training_history.json").write_text(
        json.dumps(historial, indent=2, ensure_ascii=False), encoding="utf-8",
    )

    # Segunda carga desde el checkpoint: la publicación solo cuenta si es legible.
    validated_model, _ = build_price_regressor(input_dim=X_train.shape[1], **arch_kwargs, device=DEVICE)
    validated_model.load_state_dict(
        torch.load(temporary_model, map_location=DEVICE, weights_only=True)
    )
    metricas, *_ = training_module.evaluar(validated_model, test_dl)
    metricas["split"] = "test"
    metricas["best_params"] = best_params
    (run_dir / "final_metrics.json").write_text(
        json.dumps(metricas, indent=2, ensure_ascii=False), encoding="utf-8",
    )

    public_model = MODELS_DIR / "price_regressor.pth"
    temporary_model.replace(public_model)
    check_model, _ = build_price_regressor(input_dim=X_train.shape[1], **arch_kwargs, device=DEVICE)
    check_model.load_state_dict(torch.load(public_model, map_location=DEVICE, weights_only=True))

    cfg = {
        "input_dim": X_train.shape[1],
        "hidden_units": arch_kwargs["hidden_units"],
        "dropout": arch_kwargs["dropout"],
        "model_path": "models/price_regressor.pth",
        "optuna_best_params": best_params,
        "optuna_run_dir": str(run_dir.resolve()),
    }
    (MODELS_DIR / "price_regressor_cfg.json").write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8",
    )
    return metricas


def _run_config(args: argparse.Namespace, run_dir: pathlib.Path, n_train: int, n_val: int) -> dict[str, Any]:
    return {
        "study_name": args.study_name,
        "run_dir": str(run_dir.resolve()),
        "n_train": n_train,
        "n_val": n_val,
        "trials_target": args.trials,
        "trial_epochs": args.trial_epochs,
        "final_epochs": args.final_epochs,
        "timeout_hours": args.timeout_hours,
        "seed": args.seed,
        "no_final_train": args.no_final_train,
        "search_space": SEARCH_SPACE,
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "device": DEVICE,
        "optuna": optuna.__version__,
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        validate_args(args)
    except ValueError as exc:
        print(f"Error: {exc}")
        return 2

    global DEVICE
    if args.device != "auto":
        DEVICE = args.device

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    training_module = load_training_module()
    training_module.DEVICE = DEVICE

    faltantes = [
        (training_module.CARDS_CSV, "ml/data-prep/prepare_price_dataset.py"),
        (training_module.SPLIT_JSON, "ml/data-prep/prepare_price_dataset.py"),
        (training_module.SCALER_JSON, "ml/data-prep/prepare_price_dataset.py"),
        (training_module.EMBEDDINGS_NPY, "pytorch/prepare_price_embeddings.py"),
        (training_module.EMBEDDINGS_IDS_JSON, "pytorch/prepare_price_embeddings.py"),
    ]
    for path, script in faltantes:
        if not path.exists():
            print(f"Error: no existe {path}.")
            print(f"Corré {script} primero.")
            return 1

    print("=" * 68)
    print("  Optuna — Estimador de Precio (PyTorch, Stage 3)")
    print(f"  Device          : {DEVICE}")
    print(f"  Trials objetivo : {args.trials}")
    print(f"  Épocas/trial    : {args.trial_epochs}")
    print("=" * 68)

    filas = training_module.cargar_cards_csv(training_module.CARDS_CSV)
    filas_por_id = {f["card_id"]: f for f in filas}
    with open(training_module.SPLIT_JSON, encoding="utf-8") as f:
        split = json.load(f)
    with open(training_module.SCALER_JSON, encoding="utf-8") as f:
        scaler = json.load(f)
    medias, desvios = scaler["mean"], scaler["std"]

    embeddings = np.load(training_module.EMBEDDINGS_NPY)
    with open(training_module.EMBEDDINGS_IDS_JSON, encoding="utf-8") as f:
        embedding_ids = json.load(f)
    embeddings_por_id = {cid: embeddings[i] for i, cid in enumerate(embedding_ids)}

    def filtrar(ids: list[str]) -> list[dict]:
        return [filas_por_id[cid] for cid in ids if cid in filas_por_id and cid in embeddings_por_id]

    train_filas = filtrar(split["train"])
    val_filas = filtrar(split["val"])
    test_filas = filtrar(split["test"])
    print(f"\n  Train: {len(train_filas):,}  Val: {len(val_filas):,}  Test: {len(test_filas):,}  (split por carta)")

    X_train, y_train = training_module.construir_features(train_filas, embeddings_por_id, medias, desvios)
    X_val, y_val = training_module.construir_features(val_filas, embeddings_por_id, medias, desvios)
    X_test, y_test = training_module.construir_features(test_filas, embeddings_por_id, medias, desvios)

    try:
        run_dir = create_or_resume_run(OUTPUT_ROOT, args.resume_dir)
    except (FileExistsError, FileNotFoundError) as exc:
        print(f"Error: {exc}")
        return 2

    print(f"  Resultados      : {run_dir}")
    config = _run_config(args, run_dir, len(X_train), len(X_val))
    (run_dir / "run_config.json").write_text(
        json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8",
    )

    sampler = optuna.samplers.TPESampler(seed=args.seed)
    pruner = optuna.pruners.MedianPruner(n_startup_trials=5, n_warmup_steps=2)
    study = optuna.create_study(
        study_name=args.study_name,
        storage=storage_url(run_dir),
        load_if_exists=True,
        direction="minimize",  # val_loss (MSE, log-space) — menor es mejor
        sampler=sampler,
        pruner=pruner,
    )
    remaining_trials = remaining_trials_to_run(study, args.trials)
    objective = make_objective(X_train, y_train, X_val, y_val, args.trial_epochs, seed=args.seed)
    timeout_seconds = args.timeout_hours * 3600 if args.timeout_hours is not None else None
    print(f"  Trials existentes: {len(study.trials)}")
    print(f"  Trials por correr: {remaining_trials}\n")

    try:
        if remaining_trials:
            study.optimize(
                objective,
                n_trials=remaining_trials,
                timeout=timeout_seconds,
                gc_after_trial=True,
                catch=(FloatingPointError, MemoryError, RuntimeError),
            )
    except KeyboardInterrupt:
        print("\nOptimización interrumpida; study.db conserva los trials terminados.")
        completed = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]
        if completed:
            save_study_artifacts(study, run_dir, config, metric_name="val_loss_log_mse")
            update_latest(OUTPUT_ROOT, run_dir)
        print(
            "Reanuda con: python 17_optuna_price_estimator.py "
            f"--resume-dir \"{run_dir}\" --trials {args.trials}"
        )
        return 130

    completed = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]
    if not completed:
        print("Error: el estudio terminó sin trials completos.")
        return 1

    summary = save_study_artifacts(study, run_dir, config, metric_name="val_loss_log_mse")
    print("\n── Mejor combinación ─────────────────────────────────────")
    print(f"  Trial          : {summary['trial_number']}")
    print(f"  val_loss (MSE) : {summary['best_value']:.4f}")
    for name, value in summary["params"].items():
        print(f"  {name:<13}: {value}")

    if not args.no_final_train:
        print(f"\nReentrenando modelo final ({args.final_epochs} épocas)...")
        metrics = train_final_model(
            study.best_params, training_module, X_train, y_train, X_val, y_val, X_test, y_test,
            args.final_epochs, run_dir, args.seed,
        )
        print(f"  R² (USD)      : {metrics['usd_space']['r2']:.3f}")
        print(f"  R² (log-USD)  : {metrics['log_space']['r2']:.3f}")
        print(f"  Modelo        : {MODELS_DIR / 'price_regressor.pth'}")

    update_latest(OUTPUT_ROOT, run_dir)
    print(f"\nOptuna completado. Artefactos: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
