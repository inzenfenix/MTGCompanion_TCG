"""
Optimiza con Optuna el clasificador binario MTG/no-MTG de TensorFlow.

Ejemplos:
    python 08_optuna_binary_classifier.py
    python 08_optuna_binary_classifier.py --trials 2 --trial-epochs 1 --no-final-train
    python 08_optuna_binary_classifier.py --resume-dir ../output/tensorflow/optuna/2026-07-21_220000
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

from src.binary_classifier import build_binary_classifier
from src.config import IMG_SIZE
from src.optuna_support import (
    create_or_resume_run,
    remaining_trials_to_run,
    save_study_artifacts,
    storage_url,
    update_latest,
)


SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
OUTPUT_ROOT = SCRIPT_DIR.parent / "output" / "tensorflow" / "optuna"
MODELS_DIR = SCRIPT_DIR / "models"

SEARCH_SPACE = {
    "learning_rate": {"low": 1e-5, "high": 1e-2, "log": True},
    "weight_decay": {"low": 1e-6, "high": 1e-2, "log": True},
    "batch_size": [16, 32, 64],
    "head_units": {"low": 64, "high": 512, "step": 64},
    "dropout": {"low": 0.0, "high": 0.5, "step": 0.05},
    "optimizer": ["adam", "adamw", "sgd"],
    "freeze_ratio": [0.50, 0.65, 0.80, 1.00],
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Optuna para detector MTG/no-MTG TensorFlow",
    )
    parser.add_argument("--skip-download", action="store_true",
                        help="Reutilizar imágenes Pokémon ya descargadas")
    parser.add_argument("--n", type=int, default=3000,
                        help="Imágenes por clase (default: 3000)")
    parser.add_argument("--trials", type=int, default=20,
                        help="Total objetivo de trials del estudio (default: 20)")
    parser.add_argument("--trial-epochs", type=int, default=6,
                        help="Máximo de épocas por trial (default: 6)")
    parser.add_argument("--final-epochs", type=int, default=15,
                        help="Épocas del reentrenamiento final (default: 15)")
    parser.add_argument("--timeout-hours", type=float,
                        help="Límite total de optimización en horas")
    parser.add_argument("--study-name", default="mtg_detector_tensorflow",
                        help="Nombre persistente del estudio")
    parser.add_argument("--resume-dir", type=pathlib.Path,
                        help="Directorio Optuna previo que contiene study.db")
    parser.add_argument("--seed", type=int, default=42,
                        help="Semilla reproducible (default: 42)")
    parser.add_argument("--no-final-train", action="store_true",
                        help="No reentrenar ni reemplazar el modelo final")
    return parser.parse_args(argv)


def validate_args(args: argparse.Namespace) -> None:
    for name in ("n", "trials", "trial_epochs", "final_epochs"):
        if getattr(args, name) <= 0:
            raise ValueError(f"--{name.replace('_', '-')} debe ser mayor que cero")
    if args.timeout_hours is not None and args.timeout_hours <= 0:
        raise ValueError("--timeout-hours debe ser mayor que cero")


def load_training_module() -> ModuleType:
    """Carga el script 07 para reutilizar descarga, dataset y evaluación."""
    path = SCRIPT_DIR / "07_binary_classifier.py"
    spec = importlib.util.spec_from_file_location("binary_classifier_training", path)
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
        "learning_rate": trial.suggest_float(
            "learning_rate", 1e-5, 1e-2, log=True,
        ),
        "weight_decay": trial.suggest_float(
            "weight_decay", 1e-6, 1e-2, log=True,
        ),
        "batch_size": trial.suggest_categorical("batch_size", [16, 32, 64]),
        "head_units": trial.suggest_int("head_units", 64, 512, step=64),
        "dropout": trial.suggest_float("dropout", 0.0, 0.5, step=0.05),
        "optimizer": trial.suggest_categorical(
            "optimizer", ["adam", "adamw", "sgd"],
        ),
        "freeze_ratio": trial.suggest_categorical(
            "freeze_ratio", [0.50, 0.65, 0.80, 1.00],
        ),
    }


def make_objective(
    training_module: ModuleType,
    train_samples: list[tuple[str, int]],
    val_samples: list[tuple[str, int]],
    trial_epochs: int,
    model_builder: Callable[..., tf.keras.Model] = build_binary_classifier,
    pruning_callback_factory: Callable[..., Any] = TFKerasPruningCallback,
    seed: int = 42,
) -> Callable[[optuna.Trial], float]:
    """Crea el objective que comparte exactamente el mismo split entre trials."""

    def objective(trial: optuna.Trial) -> float:
        tf.keras.backend.clear_session()
        tf.keras.utils.set_random_seed(seed)
        params = suggest_parameters(trial)
        try:
            train_ds = training_module.build_dataset(
                train_samples,
                training=True,
                batch_size=params["batch_size"],
            )
            val_ds = training_module.build_dataset(
                val_samples,
                training=False,
                batch_size=params["batch_size"],
            )
            model = model_builder(
                freeze_ratio=params["freeze_ratio"],
                learning_rate=params["learning_rate"],
                weight_decay=params["weight_decay"],
                head_units=params["head_units"],
                dropout=params["dropout"],
                optimizer_name=params["optimizer"],
            )
            history = model.fit(
                train_ds,
                validation_data=val_ds,
                epochs=trial_epochs,
                callbacks=[pruning_callback_factory(trial, "val_accuracy")],
                shuffle=False,
                verbose=2,
            )
            values = history.history.get("val_accuracy", [])
            if not values:
                raise FloatingPointError("El trial no produjo val_accuracy")
            best_value = float(max(values))
            if not np.isfinite(best_value):
                raise FloatingPointError("val_accuracy no finita")
            trial.set_user_attr("best_epoch", int(np.argmax(values)) + 1)
            return best_value
        finally:
            tf.keras.backend.clear_session()

    return objective


def _serializable_history(history: tf.keras.callbacks.History) -> dict[str, list[float]]:
    return {
        name: [float(value) for value in values]
        for name, values in history.history.items()
    }


def train_final_model(
    best_params: dict[str, Any],
    training_module: ModuleType,
    train_samples: list[tuple[str, int]],
    val_samples: list[tuple[str, int]],
    epochs: int,
    run_dir: pathlib.Path,
    effective_n: int,
    seed: int,
) -> dict[str, Any]:
    """Reentrena el ganador y publica el modelo solo tras validar el checkpoint."""
    tf.keras.backend.clear_session()
    tf.keras.utils.set_random_seed(seed)
    batch_size = int(best_params["batch_size"])
    train_ds = training_module.build_dataset(train_samples, True, batch_size)
    val_ds = training_module.build_dataset(val_samples, False, batch_size)
    y_true_val = np.array([label for _, label in val_samples], dtype=int)

    model = build_binary_classifier(
        freeze_ratio=float(best_params["freeze_ratio"]),
        learning_rate=float(best_params["learning_rate"]),
        weight_decay=float(best_params["weight_decay"]),
        head_units=int(best_params["head_units"]),
        dropout=float(best_params["dropout"]),
        optimizer_name=str(best_params["optimizer"]),
    )

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    temporary_model = MODELS_DIR / "mtg_detector.optuna_tmp.keras"
    if temporary_model.exists():
        temporary_model.unlink()
    checkpoint = tf.keras.callbacks.ModelCheckpoint(
        filepath=str(temporary_model),
        monitor="val_accuracy",
        mode="max",
        save_best_only=True,
        verbose=0,
    )
    history = model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=epochs,
        callbacks=[checkpoint],
        shuffle=False,
        verbose=2,
    )
    history_data = _serializable_history(history)
    (run_dir / "final_training_history.json").write_text(
        json.dumps(history_data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    validated_model = tf.keras.models.load_model(temporary_model)
    metrics, *_ = training_module.evaluar(
        validated_model,
        val_ds,
        y_true_val,
    )
    metrics["split"] = "validation_used_for_model_selection"
    metrics["best_params"] = best_params
    (run_dir / "final_metrics.json").write_text(
        json.dumps(metrics, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    public_model = MODELS_DIR / "mtg_detector.keras"
    temporary_model.replace(public_model)
    # Segunda carga desde la ruta publica: la publicación solo cuenta si es legible.
    tf.keras.models.load_model(public_model)

    cfg = {
        "threshold": 0.5,
        "model_path": "models/mtg_detector.keras",
        "n_per_class": effective_n,
        "img_size": list(IMG_SIZE),
        "optuna_best_params": best_params,
        "optuna_run_dir": str(run_dir.resolve()),
    }
    (MODELS_DIR / "mtg_detector_cfg.json").write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    tf.keras.backend.clear_session()
    return metrics


def _run_config(
    args: argparse.Namespace,
    run_dir: pathlib.Path,
    effective_n: int,
) -> dict[str, Any]:
    return {
        "study_name": args.study_name,
        "run_dir": str(run_dir.resolve()),
        "n_per_class_requested": args.n,
        "n_per_class_effective": effective_n,
        "trials_target": args.trials,
        "trial_epochs": args.trial_epochs,
        "final_epochs": args.final_epochs,
        "timeout_hours": args.timeout_hours,
        "seed": args.seed,
        "skip_download": args.skip_download,
        "no_final_train": args.no_final_train,
        "search_space": SEARCH_SPACE,
        "python": sys.version.split()[0],
        "tensorflow": tf.__version__,
        "optuna": optuna.__version__,
    }


def _print_missing_dataset(path: pathlib.Path) -> None:
    print(f"Error: se encontraron menos de 500 imágenes MTG en {path}.")
    print("Reconstruye el dataset desde ml/training con:")
    print("  python 01_scraper.py --max-cards 5000 --quality small")
    print("  python 02_downloader.py")


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

    mtg_paths = [str(path) for path in training_module.IMAGES_MTG.glob("*.jpg")]
    if len(mtg_paths) < 500:
        _print_missing_dataset(training_module.IMAGES_MTG)
        return 1

    print("=" * 68)
    print("  Optuna — Clasificador MTG / No-MTG (TensorFlow)")
    print(f"  MTG disponibles : {len(mtg_paths):,}")
    print(f"  Trials objetivo : {args.trials}")
    print(f"  Épocas/trial    : {args.trial_epochs}")
    print("=" * 68)

    negative_paths = training_module.descargar_negativos(
        args.n,
        skip=args.skip_download,
    )
    if len(negative_paths) < 100:
        print("Error: hay menos de 100 imágenes negativas disponibles.")
        return 1

    # preparar_muestras usa el SEED global del script 07.
    training_module.SEED = args.seed
    train_samples, val_samples = training_module.preparar_muestras(
        mtg_paths,
        negative_paths,
        args.n,
    )
    effective_n = (len(train_samples) + len(val_samples)) // 2
    print(f"  Train           : {len(train_samples):,}")
    print(f"  Validation      : {len(val_samples):,}")
    print(f"  Efectivo/clase  : {effective_n:,}")

    try:
        run_dir = create_or_resume_run(OUTPUT_ROOT, args.resume_dir)
    except (FileExistsError, FileNotFoundError) as exc:
        print(f"Error: {exc}")
        return 2

    print(f"  Resultados      : {run_dir}")
    config = _run_config(args, run_dir, effective_n)
    (run_dir / "run_config.json").write_text(
        json.dumps(config, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    sampler = optuna.samplers.TPESampler(seed=args.seed)
    pruner = optuna.pruners.MedianPruner(
        n_startup_trials=5,
        n_warmup_steps=2,
    )
    study = optuna.create_study(
        study_name=args.study_name,
        storage=storage_url(run_dir),
        load_if_exists=True,
        direction="maximize",
        sampler=sampler,
        pruner=pruner,
    )
    remaining_trials = remaining_trials_to_run(study, args.trials)
    objective = make_objective(
        training_module,
        train_samples,
        val_samples,
        args.trial_epochs,
        seed=args.seed,
    )
    timeout_seconds = (
        args.timeout_hours * 3600 if args.timeout_hours is not None else None
    )
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
        completed = [
            trial for trial in study.trials
            if trial.state == optuna.trial.TrialState.COMPLETE
        ]
        if completed:
            save_study_artifacts(study, run_dir, config)
            update_latest(OUTPUT_ROOT, run_dir)
        print(
            "Reanuda con: python 08_optuna_binary_classifier.py "
            f"--resume-dir \"{run_dir}\" --trials {args.trials}"
        )
        return 130

    completed = [
        trial for trial in study.trials
        if trial.state == optuna.trial.TrialState.COMPLETE
    ]
    if not completed:
        print("Error: el estudio terminó sin trials completos.")
        return 1

    summary = save_study_artifacts(study, run_dir, config)
    print("\n── Mejor combinación ─────────────────────────────────────")
    print(f"  Trial        : {summary['trial_number']}")
    print(f"  val_accuracy : {summary['best_value']:.4f}")
    for name, value in summary["params"].items():
        print(f"  {name:<13}: {value}")

    if not args.no_final_train:
        print(f"\nReentrenando modelo final ({args.final_epochs} épocas)...")
        metrics = train_final_model(
            study.best_params,
            training_module,
            train_samples,
            val_samples,
            args.final_epochs,
            run_dir,
            effective_n,
            args.seed,
        )
        print(f"  Accuracy : {metrics['accuracy']:.4f}")
        print(f"  F1       : {metrics['f1']:.4f}")
        print(f"  ROC-AUC  : {metrics['roc_auc']:.4f}")
        print(f"  Modelo   : {MODELS_DIR / 'mtg_detector.keras'}")

    update_latest(OUTPUT_ROOT, run_dir)
    print(f"\nOptuna completado. Artefactos: {run_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
