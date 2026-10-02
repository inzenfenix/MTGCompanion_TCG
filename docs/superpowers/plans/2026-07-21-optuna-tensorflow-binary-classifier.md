# Optuna TensorFlow Binary Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir y verificar un flujo Optuna reanudable que optimice el clasificador MTG/no-MTG TensorFlow existente, genere evidencia y reentrene el modelo final.

**Architecture:** El constructor Keras existente se vuelve parametrizable sin cambiar sus defaults. Un módulo `src/optuna_support.py` concentra persistencia y artefactos independientes del CLI, mientras `08_optuna_binary_classifier.py` reutiliza por `importlib` la descarga y el dataset de `07_binary_classifier.py`, ejecuta el estudio y reentrena el ganador.

**Tech Stack:** Python 3.12, TensorFlow/Keras >=2.16, Optuna, Optuna Integration, NumPy, scikit-learn, Matplotlib y `unittest`.

## Global Constraints

- No ejecutar `git`, no crear commits y no hacer push, por instrucción explícita del usuario.
- Implementar solo TensorFlow dentro de `ml/training/tensorFlow/`.
- Defaults nocturnos: 3.000 imágenes por clase, 20 trials, 6 épocas por trial y 15 épocas finales.
- Usar TPE con seed `42`, dirección `maximize` y poda sobre `val_accuracy`.
- Persistir el estudio en SQLite y permitir reanudar mediante `--resume-dir`.
- Mantener `training=False` al invocar MobileNetV2 para proteger BatchNormalization.
- No integrar `mtg_detector.keras` con `tensorFlow/scanner.py` en este trabajo.
- Guardar resultados en `ml/training/output/tensorflow/optuna/{timestamp}/`.
- No reemplazar `models/mtg_detector.keras` hasta validar que el checkpoint final se puede cargar.

## File Map

- Modify: `ml/training/tensorFlow/src/binary_classifier.py` — constructor y optimizadores parametrizables.
- Create: `ml/training/tensorFlow/src/optuna_support.py` — rutas, serialización, gráficos y enlace `latest`.
- Create: `ml/training/tensorFlow/08_optuna_binary_classifier.py` — CLI, objective, estudio y reentrenamiento.
- Create: `ml/training/tensorFlow/tests/test_binary_classifier_optuna.py` — pruebas del constructor parametrizable.
- Create: `ml/training/tensorFlow/tests/test_optuna_support.py` — pruebas de persistencia y artefactos.
- Modify: `ml/training/tensorFlow/requirements.txt` — dependencias Optuna.
- Modify: `ml/data-prep/README.md` — instrucciones, salidas y checklist de la entrega inmediata.

---

### Task 1: Parametrizar el constructor Keras de forma retrocompatible

**Files:**
- Modify: `ml/training/tensorFlow/src/binary_classifier.py`
- Create: `ml/training/tensorFlow/tests/test_binary_classifier_optuna.py`

**Interfaces:**
- Produces: `build_optimizer(name: str, learning_rate: float, weight_decay: float) -> tf.keras.optimizers.Optimizer`.
- Produces: `build_binary_classifier(freeze_ratio=0.65, learning_rate=3e-4, weight_decay=0.0, head_units=256, dropout=None, optimizer_name="adam") -> tf.keras.Model`.
- Invariant: `dropout=None` crea tasas `0.3` y `0.2`; un float crea dos capas con esa misma tasa.

- [ ] **Step 1: escribir pruebas fallidas para optimizadores y validación**

```python
import unittest

import tensorflow as tf

from src.binary_classifier import build_optimizer


class OptimizerFactoryTests(unittest.TestCase):
    def test_builds_supported_optimizers(self):
        self.assertIsInstance(build_optimizer("adam", 1e-3, 1e-5), tf.keras.optimizers.Adam)
        self.assertIsInstance(build_optimizer("adamw", 1e-3, 1e-5), tf.keras.optimizers.AdamW)
        self.assertIsInstance(build_optimizer("sgd", 1e-3, 1e-5), tf.keras.optimizers.SGD)

    def test_rejects_unknown_optimizer(self):
        with self.assertRaisesRegex(ValueError, "Optimizador no soportado"):
            build_optimizer("rmsprop", 1e-3, 0.0)
```

- [ ] **Step 2: ejecutar y comprobar el fallo esperado**

Run: `python -m unittest tests.test_binary_classifier_optuna -v`

Expected: `ImportError: cannot import name 'build_optimizer'`.

- [ ] **Step 3: implementar la factoría mínima**

```python
def build_optimizer(name: str, learning_rate: float, weight_decay: float):
    normalized = name.strip().lower()
    common = {"learning_rate": learning_rate, "weight_decay": weight_decay}
    if normalized == "adam":
        return tf.keras.optimizers.Adam(**common)
    if normalized == "adamw":
        return tf.keras.optimizers.AdamW(**common)
    if normalized == "sgd":
        return tf.keras.optimizers.SGD(momentum=0.9, **common)
    raise ValueError(f"Optimizador no soportado: {name}")
```

- [ ] **Step 4: ejecutar las pruebas de la factoría**

Run: `python -m unittest tests.test_binary_classifier_optuna -v`

Expected: `OK` con 2 pruebas.

- [ ] **Step 5: agregar pruebas fallidas del modelo parametrizable con MobileNetV2 simulado**

```python
from unittest.mock import patch


def fake_backbone(*args, **kwargs):
    inputs = tf.keras.Input(shape=(224, 224, 3))
    x = tf.keras.layers.GlobalAveragePooling2D()(inputs)
    outputs = tf.keras.layers.Dense(8)(x)
    return tf.keras.Model(inputs, outputs, name="fake_backbone")


class BinaryClassifierBuilderTests(unittest.TestCase):
    @patch("src.binary_classifier.tf.keras.applications.MobileNetV2", side_effect=fake_backbone)
    def test_defaults_keep_existing_head(self, _mock):
        model = build_binary_classifier()
        dense = [layer for layer in model.layers if isinstance(layer, tf.keras.layers.Dense)]
        dropout = [layer.rate for layer in model.layers if isinstance(layer, tf.keras.layers.Dropout)]
        self.assertEqual(dense[-2].units, 256)
        self.assertEqual(dropout, [0.3, 0.2])
        self.assertIsInstance(model.optimizer, tf.keras.optimizers.Adam)

    @patch("src.binary_classifier.tf.keras.applications.MobileNetV2", side_effect=fake_backbone)
    def test_applies_trial_head_parameters(self, _mock):
        model = build_binary_classifier(
            head_units=128,
            dropout=0.4,
            optimizer_name="sgd",
            learning_rate=1e-3,
            weight_decay=1e-4,
        )
        dense = [layer for layer in model.layers if isinstance(layer, tf.keras.layers.Dense)]
        dropout = [layer.rate for layer in model.layers if isinstance(layer, tf.keras.layers.Dropout)]
        self.assertEqual(dense[-2].units, 128)
        self.assertEqual(dropout, [0.4, 0.4])
        self.assertIsInstance(model.optimizer, tf.keras.optimizers.SGD)
```

- [ ] **Step 6: ejecutar y comprobar el fallo por firma fija**

Run: `python -m unittest tests.test_binary_classifier_optuna.BinaryClassifierBuilderTests -v`

Expected: FAIL porque `build_binary_classifier()` aún no acepta los argumentos nuevos.

- [ ] **Step 7: parametrizar el constructor**

```python
def build_binary_classifier(
    freeze_ratio: float = FREEZE_RATIO,
    learning_rate: float = 3e-4,
    weight_decay: float = 0.0,
    head_units: int = 256,
    dropout: float | None = None,
    optimizer_name: str = "adam",
) -> tf.keras.Model:
    if not 0.0 <= freeze_ratio <= 1.0:
        raise ValueError("freeze_ratio debe estar entre 0.0 y 1.0")
    if head_units <= 0:
        raise ValueError("head_units debe ser positivo")
    if dropout is not None and not 0.0 <= dropout <= 1.0:
        raise ValueError("dropout debe estar entre 0.0 y 1.0")
    dropout_1, dropout_2 = (0.3, 0.2) if dropout is None else (dropout, dropout)
    # Conservar creación y congelación del backbone existente.
    # Sustituir las unidades y dropout fijos por head_units/dropout_1/dropout_2.
    model.compile(
        optimizer=build_optimizer(optimizer_name, learning_rate, weight_decay),
        loss="binary_crossentropy",
        metrics=["accuracy"],
    )
    return model
```

- [ ] **Step 8: ejecutar pruebas nuevas y regresión existente**

Run: `python -m unittest discover -s tests -v`

Expected: todas las pruebas `OK`.

---

### Task 2: Implementar persistencia y artefactos Optuna

**Files:**
- Create: `ml/training/tensorFlow/src/optuna_support.py`
- Create: `ml/training/tensorFlow/tests/test_optuna_support.py`

**Interfaces:**
- Produces: `create_or_resume_run(output_root: Path, resume_dir: Path | None, timestamp: str | None = None) -> Path`.
- Produces: `storage_url(run_dir: Path) -> str`.
- Produces: `save_study_artifacts(study: optuna.Study, run_dir: Path, run_config: dict) -> dict`.
- Produces: `update_latest(output_root: Path, run_dir: Path) -> None`.

- [ ] **Step 1: escribir pruebas fallidas de rutas y SQLite**

```python
import tempfile
import unittest
from pathlib import Path

from src.optuna_support import create_or_resume_run, storage_url


class RunDirectoryTests(unittest.TestCase):
    def test_creates_timestamped_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = create_or_resume_run(Path(tmp), None, "2026-07-21_220000")
            self.assertEqual(run.name, "2026-07-21_220000")
            self.assertTrue(run.is_dir())
            self.assertTrue(storage_url(run).startswith("sqlite:///"))

    def test_resume_requires_existing_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "missing"
            with self.assertRaisesRegex(FileNotFoundError, "resume-dir"):
                create_or_resume_run(Path(tmp), missing)
```

- [ ] **Step 2: ejecutar y comprobar el fallo de importación**

Run: `python -m unittest tests.test_optuna_support.RunDirectoryTests -v`

Expected: `ModuleNotFoundError: No module named 'src.optuna_support'`.

- [ ] **Step 3: implementar creación/reanudación y URL absoluta portable**

```python
from datetime import datetime
from pathlib import Path


def create_or_resume_run(output_root, resume_dir, timestamp=None):
    if resume_dir is not None:
        run_dir = Path(resume_dir).resolve()
        if not run_dir.is_dir():
            raise FileNotFoundError(f"--resume-dir no existe: {run_dir}")
        return run_dir
    stamp = timestamp or datetime.now().strftime("%Y-%m-%d_%H%M%S")
    run_dir = Path(output_root).resolve() / stamp
    run_dir.mkdir(parents=True, exist_ok=False)
    return run_dir


def storage_url(run_dir):
    return f"sqlite:///{(Path(run_dir) / 'study.db').resolve().as_posix()}"
```

- [ ] **Step 4: ejecutar pruebas de rutas**

Run: `python -m unittest tests.test_optuna_support.RunDirectoryTests -v`

Expected: `OK` con 2 pruebas.

- [ ] **Step 5: escribir prueba fallida de serialización de estudio**

```python
import json
import optuna

from src.optuna_support import save_study_artifacts


class StudyArtifactTests(unittest.TestCase):
    def test_saves_required_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp)
            study = optuna.create_study(direction="maximize")
            study.optimize(lambda trial: trial.suggest_float("x", 0.0, 1.0), n_trials=3)
            summary = save_study_artifacts(study, run, {"seed": 42})
            for name in (
                "run_config.json", "trials.csv", "best_params.json",
                "optuna_historia.png", "optuna_importancia.png",
            ):
                self.assertTrue((run / name).is_file(), name)
            saved = json.loads((run / "best_params.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["trial_number"], study.best_trial.number)
            self.assertEqual(summary["best_value"], study.best_value)
```

- [ ] **Step 6: ejecutar y comprobar el fallo por función ausente**

Run: `python -m unittest tests.test_optuna_support.StudyArtifactTests -v`

Expected: FAIL porque `save_study_artifacts` no existe.

- [ ] **Step 7: implementar JSON, CSV y gráficos con fallback**

```python
import json
import matplotlib.pyplot as plt
import optuna


def _write_importance_plot(study, path):
    try:
        ax = optuna.visualization.matplotlib.plot_param_importances(study)
        ax.figure.savefig(path, dpi=150, bbox_inches="tight")
        plt.close(ax.figure)
    except (ValueError, RuntimeError) as exc:
        fig, ax = plt.subplots(figsize=(8, 4))
        ax.axis("off")
        ax.text(0.5, 0.5, f"Importancia no disponible: {exc}", ha="center", va="center", wrap=True)
        fig.savefig(path, dpi=150, bbox_inches="tight")
        plt.close(fig)


def save_study_artifacts(study, run_dir, run_config):
    run_dir = Path(run_dir)
    (run_dir / "run_config.json").write_text(
        json.dumps(run_config, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    study.trials_dataframe().to_csv(run_dir / "trials.csv", index=False)
    best = {
        "trial_number": study.best_trial.number,
        "best_value": float(study.best_value),
        "metric": "val_accuracy",
        "params": study.best_params,
        "study_name": study.study_name,
    }
    (run_dir / "best_params.json").write_text(
        json.dumps(best, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    ax = optuna.visualization.matplotlib.plot_optimization_history(study)
    ax.figure.savefig(run_dir / "optuna_historia.png", dpi=150, bbox_inches="tight")
    plt.close(ax.figure)
    _write_importance_plot(study, run_dir / "optuna_importancia.png")
    return best
```

- [ ] **Step 8: escribir e implementar prueba de `latest` sin depender de symlinks**

```python
def test_update_latest_exposes_run_contents(self):
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        run = root / "2026-07-21_220000"
        run.mkdir()
        (run / "best_params.json").write_text("{}", encoding="utf-8")
        update_latest(root, run)
        self.assertTrue((root / "latest" / "best_params.json").is_file())
```

Implementación: borrar `latest` existente; intentar `latest.symlink_to(run.name, target_is_directory=True)` y, ante `OSError`, usar `shutil.copytree(run, latest)`.

- [ ] **Step 9: ejecutar las pruebas del módulo**

Run: `python -m unittest tests.test_optuna_support -v`

Expected: todas las pruebas `OK`.

---

### Task 3: Construir el CLI de optimización y reentrenamiento

**Files:**
- Create: `ml/training/tensorFlow/08_optuna_binary_classifier.py`
- Modify: `ml/training/tensorFlow/requirements.txt`

**Interfaces:**
- Produces: `parse_args(argv: list[str] | None = None) -> argparse.Namespace`.
- Produces: `load_training_module() -> ModuleType` para acceder a `preparar_muestras`, `build_dataset`, `descargar_negativos`, `evaluar` e `IMAGES_MTG`.
- Produces: `make_objective(training_module, train_samples, val_samples, trial_epochs) -> Callable[[optuna.Trial], float]`.
- Produces: `train_final_model(best_params, training_module, train_samples, val_samples, epochs, run_dir) -> dict`.
- Produces: `main(argv: list[str] | None = None) -> int`.

- [ ] **Step 1: agregar dependencias verificadas**

```text
optuna>=4.0,<6
optuna-integration[tfkeras]>=4.0,<6
```

- [ ] **Step 2: escribir pruebas fallidas de argumentos sin ejecutar entrenamiento**

Agregar a `tests/test_optuna_support.py` una carga por `importlib` del script y:

```python
class CliDefaultsTests(unittest.TestCase):
    def test_nightly_defaults(self):
        module = load_script("08_optuna_binary_classifier.py")
        args = module.parse_args([])
        self.assertEqual(args.n, 3000)
        self.assertEqual(args.trials, 20)
        self.assertEqual(args.trial_epochs, 6)
        self.assertEqual(args.final_epochs, 15)
        self.assertEqual(args.seed, 42)
```

- [ ] **Step 3: ejecutar y comprobar el fallo por script ausente**

Run: `python -m unittest tests.test_optuna_support.CliDefaultsTests -v`

Expected: `FileNotFoundError` para `08_optuna_binary_classifier.py`.

- [ ] **Step 4: implementar imports, constantes, parser y carga del módulo 07**

```python
SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
OUTPUT_ROOT = SCRIPT_DIR.parent / "output" / "tensorflow" / "optuna"
SEARCH_SPACE = {
    "learning_rate": [1e-5, 1e-2, "log"],
    "weight_decay": [1e-6, 1e-2, "log"],
    "batch_size": [16, 32, 64],
    "head_units": [64, 512, 64],
    "dropout": [0.0, 0.5, 0.05],
    "optimizer": ["adam", "adamw", "sgd"],
    "freeze_ratio": [0.50, 0.65, 0.80, 1.00],
}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Optuna para detector MTG/no-MTG TensorFlow")
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--n", type=int, default=3000)
    parser.add_argument("--trials", type=int, default=20)
    parser.add_argument("--trial-epochs", type=int, default=6)
    parser.add_argument("--final-epochs", type=int, default=15)
    parser.add_argument("--timeout-hours", type=float)
    parser.add_argument("--study-name", default="mtg_detector_tensorflow")
    parser.add_argument("--resume-dir", type=pathlib.Path)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-final-train", action="store_true")
    return parser.parse_args(argv)


def load_training_module():
    path = SCRIPT_DIR / "07_binary_classifier.py"
    spec = importlib.util.spec_from_file_location("binary_classifier_training", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module
```

- [ ] **Step 5: ejecutar y aprobar la prueba de defaults**

Run: `python -m unittest tests.test_optuna_support.CliDefaultsTests -v`

Expected: `OK`.

- [ ] **Step 6: implementar objective con poda, cleanup y métrica máxima**

```python
def make_objective(training_module, train_samples, val_samples, trial_epochs):
    def objective(trial):
        tf.keras.backend.clear_session()
        params = {
            "learning_rate": trial.suggest_float("learning_rate", 1e-5, 1e-2, log=True),
            "weight_decay": trial.suggest_float("weight_decay", 1e-6, 1e-2, log=True),
            "batch_size": trial.suggest_categorical("batch_size", [16, 32, 64]),
            "head_units": trial.suggest_int("head_units", 64, 512, step=64),
            "dropout": trial.suggest_float("dropout", 0.0, 0.5, step=0.05),
            "optimizer": trial.suggest_categorical("optimizer", ["adam", "adamw", "sgd"]),
            "freeze_ratio": trial.suggest_categorical("freeze_ratio", [0.50, 0.65, 0.80, 1.00]),
        }
        train_ds = training_module.build_dataset(train_samples, True, params["batch_size"])
        val_ds = training_module.build_dataset(val_samples, False, params["batch_size"])
        model = build_binary_classifier(
            freeze_ratio=params["freeze_ratio"], learning_rate=params["learning_rate"],
            weight_decay=params["weight_decay"], head_units=params["head_units"],
            dropout=params["dropout"], optimizer_name=params["optimizer"],
        )
        history = model.fit(
            train_ds, validation_data=val_ds, epochs=trial_epochs, verbose=2,
            callbacks=[TFKerasPruningCallback(trial, "val_accuracy")],
        )
        best = float(max(history.history["val_accuracy"]))
        if not np.isfinite(best):
            raise FloatingPointError("val_accuracy no finita")
        return best
    return objective
```

- [ ] **Step 7: implementar reentrenamiento final seguro y métricas**

Crear `models/mtg_detector.optuna_tmp.keras`; entrenar con `ModelCheckpoint`
monitorizando `val_accuracy`, cargar el checkpoint, evaluar mediante
`training_module.evaluar`, escribir `final_metrics.json` y
`final_training_history.json`, validar con `load_model`, reemplazar con
`Path.replace()` el modelo público y escribir `mtg_detector_cfg.json`.

El JSON de configuración debe contener exactamente:

```python
{
    "threshold": 0.5,
    "model_path": "models/mtg_detector.keras",
    "n_per_class": effective_n,
    "img_size": list(IMG_SIZE),
    "optuna_best_params": best_params,
    "optuna_run_dir": str(run_dir),
}
```

- [ ] **Step 8: implementar `main()` y códigos de salida**

`main()` debe validar argumentos positivos, comprobar al menos 500 JPG MTG,
descargar negativos, construir el split una vez, crear/reanudar el estudio con
`TPESampler(seed=args.seed)` y `MedianPruner(n_startup_trials=5,
n_warmup_steps=2)`, ejecutar `study.optimize(..., catch=(ResourceExhaustedError,
FloatingPointError))`, guardar artefactos, entrenar el modelo final salvo
`--no-final-train`, actualizar `latest` y retornar `0`. Si falta dataset o no
hay trials completos, debe retornar `1`. `if __name__ == "__main__"` debe usar
`raise SystemExit(main())`.

- [ ] **Step 9: verificar compilación y ayuda del CLI**

Run: `python -m py_compile 08_optuna_binary_classifier.py src/binary_classifier.py src/optuna_support.py`

Expected: exit code `0`, sin salida.

Run: `python 08_optuna_binary_classifier.py --help`

Expected: exit code `0` y presencia de `--trials`, `--resume-dir` y
`--no-final-train`.

---

### Task 4: Documentar y verificar el flujo completo

**Files:**
- Modify: `ml/data-prep/README.md`
- Test: `ml/training/tensorFlow/tests/test_binary_classifier_optuna.py`
- Test: `ml/training/tensorFlow/tests/test_optuna_support.py`

**Interfaces:**
- Consumes: CLI y artefactos creados en Tasks 1–3.
- Produces: instrucciones reproducibles desde descarga hasta corrida nocturna y reanudación.

- [ ] **Step 1: actualizar checklist e instrucciones del README**

Marcar como implementados la dependencia y el script. Agregar comandos exactos
para Python 3.12, entorno virtual, descarga, smoke test, corrida nocturna y
reanudación. Mantener sin marcar “reentrenar modelo” y “best_params” hasta que
una corrida real produzca esos artefactos; explicar que código implementado no
equivale a resultados experimentales ya obtenidos.

```powershell
py -3.12 -m venv tensorFlow\.venv
tensorFlow\.venv\Scripts\python.exe -m pip install --upgrade pip
tensorFlow\.venv\Scripts\python.exe -m pip install -r tensorFlow\requirements.txt
tensorFlow\.venv\Scripts\python.exe 01_scraper.py --max-cards 5000 --quality small
tensorFlow\.venv\Scripts\python.exe 02_downloader.py
cd tensorFlow
.venv\Scripts\python.exe 08_optuna_binary_classifier.py --trials 20 --trial-epochs 6 --final-epochs 15
```

- [ ] **Step 2: ejecutar suite automatizada completa**

Run: `python -m unittest discover -s tests -v`

Expected: todas las pruebas `OK`.

- [ ] **Step 3: ejecutar smoke test real cuando existan dependencias y dataset**

Run: `.venv\Scripts\python.exe 08_optuna_binary_classifier.py --n 500 --trials 2 --trial-epochs 1 --no-final-train --skip-download`

Expected: exit code `0` y archivos `study.db`, `best_params.json`, `trials.csv`,
`optuna_historia.png` y `optuna_importancia.png` bajo un timestamp nuevo.

- [ ] **Step 4: validar artefactos del smoke test**

Run: `Get-ChildItem ..\output\tensorflow\optuna\latest | Select-Object Name`

Expected: aparecen los cinco archivos exigidos y `run_config.json`.

- [ ] **Step 5: preparar la corrida nocturna**

Run: `.venv\Scripts\python.exe 08_optuna_binary_classifier.py --trials 20 --trial-epochs 6 --final-epochs 15 --skip-download`

Expected: el proceso inicia o reanuda el estudio, imprime el directorio de
resultados y comienza el trial 0 sin fallos de importación ni de dataset.

## Plan Self-Review

- Cobertura: constructor, búsqueda, poda, persistencia, reanudación, artefactos,
  modelo final, configuración, documentación y pruebas están asignados a tareas.
- Alcance: no se incluye PyTorch ni integración con scanner.
- Tipos: `Path`, nombres de parámetros y claves JSON coinciden entre las tareas.
- Operación: no se incluyen comandos Git y el modelo público solo se reemplaza
  tras validar el checkpoint.

