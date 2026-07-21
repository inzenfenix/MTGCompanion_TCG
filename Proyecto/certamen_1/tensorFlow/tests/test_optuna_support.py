import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import optuna

from src.optuna_support import (
    create_or_resume_run,
    remaining_trials_to_run,
    save_study_artifacts,
    storage_url,
    update_latest,
)


class RunDirectoryTests(unittest.TestCase):
    def test_creates_timestamped_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = create_or_resume_run(
                Path(tmp),
                resume_dir=None,
                timestamp="2026-07-21_220000",
            )

            self.assertEqual(run.name, "2026-07-21_220000")
            self.assertTrue(run.is_dir())
            self.assertTrue(storage_url(run).startswith("sqlite:///"))
            self.assertTrue(storage_url(run).endswith("study.db"))

    def test_resume_requires_existing_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "missing"

            with self.assertRaisesRegex(FileNotFoundError, "resume-dir"):
                create_or_resume_run(Path(tmp), resume_dir=missing)

    def test_resume_returns_existing_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            existing = Path(tmp) / "existing"
            existing.mkdir()

            resumed = create_or_resume_run(Path(tmp), resume_dir=existing)

            self.assertEqual(resumed, existing.resolve())


class StudyArtifactTests(unittest.TestCase):
    def test_resume_ignores_stale_running_trials(self):
        study = SimpleNamespace(
            trials=[
                SimpleNamespace(state=optuna.trial.TrialState.COMPLETE),
                SimpleNamespace(state=optuna.trial.TrialState.PRUNED),
                SimpleNamespace(state=optuna.trial.TrialState.FAIL),
                SimpleNamespace(state=optuna.trial.TrialState.RUNNING),
                SimpleNamespace(state=optuna.trial.TrialState.WAITING),
            ]
        )

        remaining = remaining_trials_to_run(study, target_trials=20)

        self.assertEqual(remaining, 17)

    def test_saves_required_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp)
            study = optuna.create_study(
                direction="maximize",
                sampler=optuna.samplers.RandomSampler(seed=42),
            )
            study.optimize(
                lambda trial: trial.suggest_float("x", 0.0, 1.0),
                n_trials=3,
            )

            summary = save_study_artifacts(study, run, {"seed": 42})

            for name in (
                "run_config.json",
                "trials.csv",
                "best_params.json",
                "optuna_historia.png",
                "optuna_importancia.png",
            ):
                self.assertTrue((run / name).is_file(), name)
            saved = json.loads(
                (run / "best_params.json").read_text(encoding="utf-8")
            )
            self.assertEqual(saved["trial_number"], study.best_trial.number)
            self.assertEqual(summary["best_value"], study.best_value)
            self.assertEqual(saved["metric"], "val_accuracy")

    def test_rejects_study_without_completed_trials(self):
        with tempfile.TemporaryDirectory() as tmp:
            study = optuna.create_study(direction="maximize")

            with self.assertRaisesRegex(ValueError, "trials completos"):
                save_study_artifacts(study, Path(tmp), {"seed": 42})

    def test_update_latest_exposes_run_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run = root / "2026-07-21_220000"
            run.mkdir()
            (run / "best_params.json").write_text("{}", encoding="utf-8")

            update_latest(root, run)

            self.assertTrue((root / "latest" / "best_params.json").is_file())


if __name__ == "__main__":
    unittest.main()
