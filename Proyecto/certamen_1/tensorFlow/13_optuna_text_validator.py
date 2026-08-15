"""
Optimiza con Optuna el validador de texto (Stage 2, TensorFlow).

Mismo patrón que 10_optuna_condition_grader.py (mismo formato de artefactos)
aplicado a 12_text_validator.py — ver
Proyecto/certamen_2/README.md, sección "Stage 2 — Validador de texto (OCR)".
Espejo de pytorch/15_optuna_text_validator.py: mismo search space (sin
freeze_ratio — TextMatcher no tiene backbone congelable, ver
src/text_matcher.py), features vectorizadas una sola vez antes de abrir el
estudio (HashingVectorizer no depende de ningún hiperparámetro del modelo).

Ejemplos:
    python 13_optuna_text_validator.py
    python 13_optuna_text_validator.py --trials 2 --trial-epochs 3 --no-final-train
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import random
import sys
from types import ModuleType
from typing import Any, Callable

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import numpy as np
import optuna
import tensorflow as tf
from optuna_integration import TFKerasPruningCallback

from src.text_matcher import N_FEATURES, build_text_matcher
from src.optuna_support import (
    create_or_resume_run,
    remaining_trials_to_run,
    save_study_artifacts,
    storage_url,
    update_latest,
)

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
OUTPUT_ROOT = SCRIPT_DIR.parent / "output" / "tensorflow" / "optuna_text_validator"
MODELS_DIR = SCRIPT_DIR / "models"

# Mismo search space que pytorch/15_optuna_text_validator.py.
SEARCH_SPACE = {
    "learning_rate": {"low": 1e-5, "high": 1e-2, "log": True},
    "weight_decay": {"low": 1e-6, "high": 1e-2, "log": True},
    "batch_size": [16, 32, 64],
    "hidden_units": {"low": 64, "high": 512, "step": 64},
    "dropout": {"low": 0.0, "high": 0.5, "step": 0.05},
    "optimizer": ["adam", "adamw", "sgd"],
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Optuna para el validador de texto TensorFlow (Stage 2)")
    parser.add_argument("--trials", type=int, default=20, help="Total objetivo de trials del estudio (default: 20)")
    parser.add_argument("--trial-epochs", type=int, default=10, help="Máximo de épocas por trial (default: 10)")
    parser.add_argument("--final-epochs", type=int, default=20, help="Épocas del reentrenamiento final (default: 20)")
    parser.add_argument("--timeout-hours", type=float, help="Límite total de optimización en horas")
    parser.add_argument("--study-name", default="text_validator_tensorflow", help="Nombre persistente del estudio")
    parser.add_argument("--resume-dir", type=pathlib.Path, help="Directorio Optuna previo que contiene study.db")
    parser.add_argument("--seed", type=int, default=42, help="Semilla reproducible (default: 42)")
    parser.add_argument("--no-final-train", action="store_true", help="No reentrenar ni reemplazar el modelo final")
    return parser.parse_args(argv)


def validate_args(args: argparse.Namespace) -> None:
    for name in ("trials", "trial_epochs", "final_epochs"):
        if getattr(args, name) <= 0:
            raise ValueError(f"--{name.replace('_', '-')} debe ser mayor que cero")
    if args.timeout_hours is not None and args.timeout_hours <= 0:
        raise ValueError("--timeout-hours debe ser mayor que cero")


def load_training_module() -> ModuleType:
    """Carga 12_text_validator.py para reutilizar dataset/split/features/evaluación."""
    path = SCRIPT_DIR / "12_text_validator.py"
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


def make_objective(
    X_train: np.ndarray, y_train: np.ndarray,
    X_val: np.ndarray, y_val: np.ndarray,
    trial_epochs: int,
    model_builder: Callable[..., tf.keras.Model] = build_text_matcher,
    pruning_callback_factory: Callable[..., Any] = TFKerasPruningCallback,
    seed: int = 42,
) -> Callable[[optuna.Trial], float]:
    """Crea el objective — el featurizado ya viene hecho (ver docstring del módulo)."""

    def objective(trial: optuna.Trial) -> float:
        tf.keras.backend.clear_session()
        tf.keras.utils.set_random_seed(seed)
        params = suggest_parameters(trial)
        try:
            model = model_builder(
                hidden_units=params["hidden_units"],
                dropout=params["dropout"],
                learning_rate=params["learning_rate"],
                weight_decay=params["weight_decay"],
                optimizer_name=params["optimizer"],
            )
            history = model.fit(
                X_train, y_train, validation_data=(X_val, y_val),
                epochs=trial_epochs, batch_size=params["batch_size"],
                callbacks=[pruning_callback_factory(trial, "val_auc")],
                shuffle=True, verbose=2,
            )
            values = history.history.get("val_auc", [])
            if not values:
                raise FloatingPointError("El trial no produjo val_auc")
            best_value = float(max(values))
            if not np.isfinite(best_value):
                raise FloatingPointError("val_auc no finita")
            trial.set_user_attr("best_epoch", int(np.argmax(values)) + 1)
            return best_value
        finally:
            tf.keras.backend.clear_session()

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
    tf.keras.backend.clear_session()
    tf.keras.utils.set_random_seed(seed)
    batch_size = int(best_params["batch_size"])

    model = build_text_matcher(
        hidden_units=int(best_params["hidden_units"]),
        dropout=float(best_params["dropout"]),
        learning_rate=float(best_params["learning_rate"]),
        weight_decay=float(best_params["weight_decay"]),
        optimizer_name=str(best_params["optimizer"]),
    )

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    temporary_model = MODELS_DIR / "text_matcher.optuna_tmp.keras"
    if temporary_model.exists():
        temporary_model.unlink()
    checkpoint = tf.keras.callbacks.ModelCheckpoint(
        filepath=str(temporary_model), monitor="val_auc", mode="max", save_best_only=True, verbose=0,
    )
    history = model.fit(
        X_train, y_train, validation_data=(X_val, y_val),
        epochs=epochs, batch_size=batch_size,
        callbacks=[checkpoint], shuffle=True, verbose=2,
    )
    history_data = {name: [float(v) for v in values] for name, values in history.history.items()}
    (run_dir / "final_training_history.json").write_text(
        json.dumps(history_data, indent=2, ensure_ascii=False), encoding="utf-8",
    )

    validated_model = tf.keras.models.load_model(temporary_model)
    metrics, *_ = training_module.evaluar(validated_model, X_val, y_val)
    metrics["split"] = "validation_used_for_model_selection"
    metrics["best_params"] = best_params
    (run_dir / "final_metrics.json").write_text(
        json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8",
    )

    public_model = MODELS_DIR / "text_matcher.keras"
    temporary_model.replace(public_model)
    tf.keras.models.load_model(public_model)  # confirma que es legible antes de publicar

    cfg = {
        "n_features": N_FEATURES,
        "input_dim": N_FEATURES * 4,
        "hidden_units": int(best_params["hidden_units"]),
        "dropout": float(best_params["dropout"]),
        "umbral_optimo": metrics["umbral_optimo"],
        "model_path": "models/text_matcher.keras",
        "optuna_best_params": best_params,
        "optuna_run_dir": str(run_dir.resolve()),
    }
    (MODELS_DIR / "text_matcher_cfg.json").write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8",
    )
    tf.keras.backend.clear_session()
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
        "tensorflow": tf.__version__,
        "optuna": optuna.__version__,
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        validate_args(args)
    except ValueError as exc:
        print(f"Error: {exc}")
        return 2

    random.seed(args.seed)
    np.random.seed(args.seed)
    tf.keras.utils.set_random_seed(args.seed)
    training_module = load_training_module()

    if not training_module.DATASET_INDEX.exists():
        print(f"Error: no existe {training_module.DATASET_INDEX}.")
        print("Corré certamen_2/prepare_text_validator_dataset.py primero.")
        return 1

    print("=" * 68)
    print("  Optuna — Validador de Texto (TensorFlow, Stage 2)")
    print(f"  Trials objetivo : {args.trials}")
    print(f"  Épocas/trial    : {args.trial_epochs}")
    print("=" * 68)

    filas = training_module.cargar_dataset(training_module.DATASET_INDEX)
    n_cartas = len({f["card_id"] for f in filas})
    print(f"\n  Pares en el dataset: {len(filas):,}  ({n_cartas:,} cartas base)")

    train_filas, val_filas = training_module.split_por_carta(filas, training_module.VAL_SPLIT, args.seed)
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
                catch=(
                    FloatingPointError,
                    MemoryError,
                    tf.errors.InvalidArgumentError,
                    tf.errors.ResourceExhaustedError,
                ),
            )
    except KeyboardInterrupt:
        print("\nOptimización interrumpida; study.db conserva los trials terminados.")
        completed = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]
        if completed:
            save_study_artifacts(study, run_dir, config, metric_name="val_auc")
            update_latest(OUTPUT_ROOT, run_dir)
        print(
            "Reanuda con: python 13_optuna_text_validator.py "
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
        print(f"  Modelo   : {MODELS_DIR / 'text_matcher.keras'}")

    update_latest(OUTPUT_ROOT, run_dir)
    print(f"\nOptuna completado. Artefactos: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
