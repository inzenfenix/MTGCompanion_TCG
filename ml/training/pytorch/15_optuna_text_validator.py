"""
Optimiza con Optuna el validador de texto (Stage 2, PyTorch).

Mismo patrón que 08_optuna_binary_classifier.py / 11_optuna_condition_grader.py
(mismo formato de artefactos: study.db, run_config.json, trials.csv,
best_params.json, optuna_historia.png, optuna_importancia.png,
final_metrics.json) aplicado a 14_text_validator.py — ver
Proyecto/certamen_2/README.md, sección "Stage 2 — Validador de texto (OCR)".

A diferencia de Stage 1/4 (imágenes), acá el featurizado (HashingVectorizer)
no depende de ningún hiperparámetro del modelo — se vectoriza una sola vez
antes de abrir el estudio, no en cada trial, así los trials solo pagan el
costo de entrenar el MLP (rápido: ~0.5M parámetros).

Ejemplos:
    python 15_optuna_text_validator.py
    python 15_optuna_text_validator.py --trials 2 --trial-epochs 3 --no-final-train
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

from src.text_matcher import N_FEATURES, build_text_matcher
from src.optuna_support import (
    create_or_resume_run,
    remaining_trials_to_run,
    save_study_artifacts,
    storage_url,
    update_latest,
)

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
OUTPUT_ROOT = SCRIPT_DIR.parent / "output" / "pytorch" / "optuna_text_validator"
MODELS_DIR = SCRIPT_DIR / "models"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Mismo criterio de search space que 08_optuna_binary_classifier.py, sin
# freeze_ratio (no hay backbone congelable acá — TextMatcher entrena desde
# cero, ver src/text_matcher.py).
SEARCH_SPACE = {
    "learning_rate": {"low": 1e-5, "high": 1e-2, "log": True},
    "weight_decay": {"low": 1e-6, "high": 1e-2, "log": True},
    "batch_size": [16, 32, 64],
    "hidden_units": {"low": 64, "high": 512, "step": 64},
    "dropout": {"low": 0.0, "high": 0.5, "step": 0.05},
    "optimizer": ["adam", "adamw", "sgd"],
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Optuna para el validador de texto PyTorch (Stage 2)")
    parser.add_argument("--trials", type=int, default=20, help="Total objetivo de trials del estudio (default: 20)")
    parser.add_argument("--trial-epochs", type=int, default=10, help="Máximo de épocas por trial (default: 10)")
    parser.add_argument("--final-epochs", type=int, default=20, help="Épocas del reentrenamiento final (default: 20)")
    parser.add_argument("--timeout-hours", type=float, help="Límite total de optimización en horas")
    parser.add_argument("--study-name", default="text_validator_pytorch", help="Nombre persistente del estudio")
    parser.add_argument("--resume-dir", type=pathlib.Path, help="Directorio Optuna previo que contiene study.db")
    parser.add_argument("--seed", type=int, default=42, help="Semilla reproducible (default: 42)")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"],
                         help="'auto' (default) usa GPU si torch.cuda.is_available(). Ver nota en 14_text_validator.py sobre ROCm.")
    parser.add_argument("--no-final-train", action="store_true", help="No reentrenar ni reemplazar el modelo final")
    return parser.parse_args(argv)


def validate_args(args: argparse.Namespace) -> None:
    for name in ("trials", "trial_epochs", "final_epochs"):
        if getattr(args, name) <= 0:
            raise ValueError(f"--{name.replace('_', '-')} debe ser mayor que cero")
    if args.timeout_hours is not None and args.timeout_hours <= 0:
        raise ValueError("--timeout-hours debe ser mayor que cero")


def load_training_module() -> ModuleType:
    """Carga 14_text_validator.py para reutilizar dataset/split/features/evaluación."""
    path = SCRIPT_DIR / "14_text_validator.py"
    spec = importlib.util.spec_from_file_location("text_validator_training", path)
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
        "batch_size": trial.suggest_categorical("batch_size", [16, 32, 64]),
        "hidden_units": trial.suggest_int("hidden_units", 64, 512, step=64),
        "dropout": trial.suggest_float("dropout", 0.0, 0.5, step=0.05),
        "optimizer": trial.suggest_categorical("optimizer", ["adam", "adamw", "sgd"]),
    }


def _liberar_cuda() -> None:
    if DEVICE == "cuda":
        torch.cuda.empty_cache()


def make_objective(
    training_module: ModuleType,
    X_train: np.ndarray, y_train: np.ndarray,
    X_val: np.ndarray, y_val: np.ndarray,
    trial_epochs: int,
    seed: int = 42,
):
    """Crea el objective — el featurizado ya viene hecho (ver docstring del módulo)."""

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
            model, optimizer = build_text_matcher(
                hidden_units=params["hidden_units"],
                dropout=params["dropout"],
                learning_rate=params["learning_rate"],
                weight_decay=params["weight_decay"],
                optimizer_name=params["optimizer"],
                device=DEVICE,
            )
            criterio = nn.BCEWithLogitsLoss()
            scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=trial_epochs)

            best_val_auc = 0.0
            for epoch in range(1, trial_epochs + 1):
                model.train()
                for x, y in train_dl:
                    x, y = x.to(DEVICE), y.to(DEVICE)
                    optimizer.zero_grad()
                    loss = criterio(model(x), y)
                    loss.backward()
                    optimizer.step()
                scheduler.step()

                metrics, *_ = training_module.evaluar(model, val_dl)
                val_auc = metrics["roc_auc"]
                best_val_auc = max(best_val_auc, val_auc)

                trial.report(val_auc, epoch)
                if trial.should_prune():
                    raise optuna.TrialPruned()

            if not np.isfinite(best_val_auc):
                raise FloatingPointError("val_auc no finita")
            return best_val_auc
        finally:
            del model, optimizer
            _liberar_cuda()

    return objective


def train_final_model(
    best_params: dict[str, Any],
    training_module: ModuleType,
    X_train: np.ndarray, y_train: np.ndarray,
    X_val: np.ndarray, y_val: np.ndarray,
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

    arch_kwargs = dict(hidden_units=int(best_params["hidden_units"]), dropout=float(best_params["dropout"]))
    model, optimizer = build_text_matcher(
        **arch_kwargs,
        learning_rate=float(best_params["learning_rate"]),
        weight_decay=float(best_params["weight_decay"]),
        optimizer_name=str(best_params["optimizer"]),
        device=DEVICE,
    )
    criterio = nn.BCEWithLogitsLoss()
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    temporary_model = MODELS_DIR / "text_matcher.optuna_tmp.pth"
    if temporary_model.exists():
        temporary_model.unlink()

    historial = []
    mejor_val_auc = -1.0
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

        metrics, *_ = training_module.evaluar(model, val_dl)
        val_auc = metrics["roc_auc"]
        scheduler.step()
        historial.append({"epoch": epoch, "train_loss": train_loss, "val_auc": val_auc})

        marker = ""
        if val_auc > mejor_val_auc:
            mejor_val_auc = val_auc
            torch.save(model.state_dict(), temporary_model)
            marker = "  ← guardado"
        print(f"  Época {epoch:02d}/{epochs}  train_loss={train_loss:.4f}  val_auc={val_auc:.4f}{marker}")

    (run_dir / "final_training_history.json").write_text(
        json.dumps(historial, indent=2, ensure_ascii=False), encoding="utf-8",
    )

    # Segunda carga desde el checkpoint: la publicación solo cuenta si es legible.
    validated_model, _ = build_text_matcher(**arch_kwargs, device=DEVICE)
    validated_model.load_state_dict(
        torch.load(temporary_model, map_location=DEVICE, weights_only=True)
    )
    validated_model.eval()
    metrics, *_ = training_module.evaluar(validated_model, val_dl)
    metrics["split"] = "validation_used_for_model_selection"
    metrics["best_params"] = best_params
    (run_dir / "final_metrics.json").write_text(
        json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8",
    )

    public_model = MODELS_DIR / "text_matcher.pth"
    temporary_model.replace(public_model)
    check_model, _ = build_text_matcher(**arch_kwargs, device=DEVICE)
    check_model.load_state_dict(torch.load(public_model, map_location=DEVICE, weights_only=True))

    cfg = {
        "n_features": N_FEATURES,
        "input_dim": N_FEATURES * 4,
        "hidden_units": arch_kwargs["hidden_units"],
        "dropout": arch_kwargs["dropout"],
        "umbral_optimo": metrics["umbral_optimo"],
        "model_path": "models/text_matcher.pth",
        "optuna_best_params": best_params,
        "optuna_run_dir": str(run_dir.resolve()),
    }
    (MODELS_DIR / "text_matcher_cfg.json").write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8",
    )
    return metrics


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
    # training_module.evaluar() usa el DEVICE propio de 14_text_validator.py
    # (detectado independientemente al importarlo) — hay que alinearlo con el
    # DEVICE de este script para que modelo e inputs terminen en el mismo
    # dispositivo. Mismo criterio que "training_module.SEED = args.seed" en
    # 08_optuna_binary_classifier.py.
    training_module.DEVICE = DEVICE

    if not training_module.DATASET_INDEX.exists():
        print(f"Error: no existe {training_module.DATASET_INDEX}.")
        print("Corré certamen_2/prepare_text_validator_dataset.py primero.")
        return 1

    print("=" * 68)
    print("  Optuna — Validador de Texto (PyTorch, Stage 2)")
    print(f"  Device          : {DEVICE}")
    print(f"  Trials objetivo : {args.trials}")
    print(f"  Épocas/trial    : {args.trial_epochs}")
    print("=" * 68)

    filas = training_module.cargar_dataset(training_module.DATASET_INDEX)
    n_cartas = len({f["card_id"] for f in filas})
    print(f"\n  Pares en el dataset: {len(filas):,}  ({n_cartas:,} cartas base)")

    train_filas, val_filas = training_module.split_por_carta(filas, training_module.VAL_SPLIT, args.seed)
    # build_vectorizer llega al namespace del módulo cargado porque
    # 14_text_validator.py lo importa de src.text_matcher (ver su cabecera).
    vectorizador = training_module.build_vectorizer()
    X_train, y_train = training_module.construir_features(train_filas, vectorizador)
    X_val, y_val = training_module.construir_features(val_filas, vectorizador)
    print(f"  Train           : {len(X_train):,}")
    print(f"  Validation      : {len(X_val):,}")

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
        direction="maximize",
        sampler=sampler,
        pruner=pruner,
    )
    remaining_trials = remaining_trials_to_run(study, args.trials)
    objective = make_objective(training_module, X_train, y_train, X_val, y_val, args.trial_epochs, seed=args.seed)
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
            save_study_artifacts(study, run_dir, config, metric_name="val_auc")
            update_latest(OUTPUT_ROOT, run_dir)
        print(
            "Reanuda con: python 15_optuna_text_validator.py "
            f"--resume-dir \"{run_dir}\" --trials {args.trials}"
        )
        return 130

    completed = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]
    if not completed:
        print("Error: el estudio terminó sin trials completos.")
        return 1

    summary = save_study_artifacts(study, run_dir, config, metric_name="val_auc")
    print("\n── Mejor combinación ─────────────────────────────────────")
    print(f"  Trial    : {summary['trial_number']}")
    print(f"  val_auc  : {summary['best_value']:.4f}")
    for name, value in summary["params"].items():
        print(f"  {name:<13}: {value}")

    if not args.no_final_train:
        print(f"\nReentrenando modelo final ({args.final_epochs} épocas)...")
        metrics = train_final_model(
            study.best_params, training_module, X_train, y_train, X_val, y_val,
            args.final_epochs, run_dir, args.seed,
        )
        print(f"  ROC-AUC  : {metrics['roc_auc']:.4f}")
        print(f"  Accuracy : {metrics['accuracy_en_umbral_optimo']:.4f}")
        print(f"  F1       : {metrics['f1_en_umbral_optimo']:.4f}")
        print(f"  Modelo   : {MODELS_DIR / 'text_matcher.pth'}")

    update_latest(OUTPUT_ROOT, run_dir)
    print(f"\nOptuna completado. Artefactos: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
