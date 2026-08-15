"""Persistencia y artefactos del estudio Optuna del detector TensorFlow."""

from __future__ import annotations

import csv
import json
import os
import pathlib
import shutil
import warnings
from datetime import datetime
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import optuna


def create_or_resume_run(
    output_root: pathlib.Path,
    resume_dir: pathlib.Path | None,
    timestamp: str | None = None,
) -> pathlib.Path:
    """Crea una corrida timestamped o valida el directorio a reanudar."""
    if resume_dir is not None:
        run_dir = pathlib.Path(resume_dir).resolve()
        if not run_dir.is_dir():
            raise FileNotFoundError(f"--resume-dir no existe: {run_dir}")
        return run_dir

    stamp = timestamp or datetime.now().strftime("%Y-%m-%d_%H%M%S")
    run_dir = pathlib.Path(output_root).resolve() / stamp
    run_dir.mkdir(parents=True, exist_ok=False)
    return run_dir


def storage_url(run_dir: pathlib.Path) -> str:
    """Retorna la URL SQLAlchemy absoluta para el SQLite de una corrida."""
    db_path = (pathlib.Path(run_dir) / "study.db").resolve().as_posix()
    return f"sqlite:///{db_path}"


def _completed_trials(study: optuna.Study) -> list[optuna.trial.FrozenTrial]:
    return [
        trial
        for trial in study.trials
        if trial.state == optuna.trial.TrialState.COMPLETE
        and trial.value is not None
    ]


def remaining_trials_to_run(study: optuna.Study, target_trials: int) -> int:
    """Calcula trials restantes sin contar RUNNING/WAITING abandonados."""
    terminal_states = {
        optuna.trial.TrialState.COMPLETE,
        optuna.trial.TrialState.PRUNED,
        optuna.trial.TrialState.FAIL,
    }
    finished = sum(trial.state in terminal_states for trial in study.trials)
    return max(0, target_trials - finished)


def _write_trials_csv(study: optuna.Study, path: pathlib.Path) -> None:
    parameter_names = sorted(
        {name for trial in study.trials for name in trial.params}
    )
    fieldnames = [
        "number",
        "state",
        "value",
        "duration_seconds",
        *[f"param_{name}" for name in parameter_names],
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for trial in study.trials:
            row: dict[str, Any] = {
                "number": trial.number,
                "state": trial.state.name,
                "value": trial.value,
                "duration_seconds": (
                    trial.duration.total_seconds() if trial.duration else None
                ),
            }
            row.update(
                {f"param_{name}": trial.params.get(name) for name in parameter_names}
            )
            writer.writerow(row)


def _write_importance_plot(study: optuna.Study, path: pathlib.Path) -> None:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", optuna.exceptions.ExperimentalWarning)
            axes = optuna.visualization.matplotlib.plot_param_importances(study)
        axes.figure.savefig(path, dpi=150, bbox_inches="tight")
        plt.close(axes.figure)
    except (ImportError, RuntimeError, ValueError) as exc:
        fig, ax = plt.subplots(figsize=(8, 4))
        ax.axis("off")
        ax.text(
            0.5,
            0.5,
            f"Importancia no disponible: {exc}",
            ha="center",
            va="center",
            wrap=True,
        )
        fig.savefig(path, dpi=150, bbox_inches="tight")
        plt.close(fig)


def save_study_artifacts(
    study: optuna.Study,
    run_dir: pathlib.Path,
    run_config: dict[str, Any],
    metric_name: str = "val_accuracy",
) -> dict[str, Any]:
    """Guarda configuración, trials, resumen ganador y gráficos del estudio.

    `metric_name` es solo la etiqueta que queda en best_params.json — el
    default preserva el comportamiento previo (Stage 1/4, que optimizan
    val_accuracy); Stage 2 (texto) pasa "val_auc" porque ahí el objective
    real es ROC-AUC, no accuracy.
    """
    if not _completed_trials(study):
        raise ValueError("El estudio no contiene trials completos")

    run_dir = pathlib.Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "run_config.json").write_text(
        json.dumps(run_config, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    _write_trials_csv(study, run_dir / "trials.csv")

    best = {
        "trial_number": study.best_trial.number,
        "best_value": float(study.best_value),
        "metric": metric_name,
        "params": study.best_params,
        "study_name": study.study_name,
        "completed_trials": len(_completed_trials(study)),
        "total_trials": len(study.trials),
    }
    (run_dir / "best_params.json").write_text(
        json.dumps(best, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", optuna.exceptions.ExperimentalWarning)
        axes = optuna.visualization.matplotlib.plot_optimization_history(study)
    axes.figure.savefig(
        run_dir / "optuna_historia.png",
        dpi=150,
        bbox_inches="tight",
    )
    plt.close(axes.figure)
    _write_importance_plot(study, run_dir / "optuna_importancia.png")
    return best


def update_latest(output_root: pathlib.Path, run_dir: pathlib.Path) -> None:
    """Expone la corrida mas reciente mediante symlink o copia en Windows."""
    output_root = pathlib.Path(output_root)
    output_root.mkdir(parents=True, exist_ok=True)
    latest = output_root / "latest"
    if latest.exists() or latest.is_symlink():
        if latest.is_symlink() or latest.is_file():
            latest.unlink()
        else:
            shutil.rmtree(latest)

    run_dir = pathlib.Path(run_dir).resolve()
    # Relativo a output_root, no absoluto: un symlink absoluto queda apuntando
    # a la ruta exacta de la máquina donde se corrió el script (ej.
    # "/home/x/Documents/GitHub/..."), y se rompe en cualquier otro clone del
    # repo cuyo path no calce carácter por carácter (mayúsculas incluidas).
    try:
        target = os.path.relpath(run_dir, start=latest.parent)
        latest.symlink_to(target, target_is_directory=True)
    except OSError:
        shutil.copytree(run_dir, latest)
