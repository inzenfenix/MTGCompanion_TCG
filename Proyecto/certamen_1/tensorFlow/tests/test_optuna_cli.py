import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import optuna


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "08_optuna_binary_classifier.py"


def load_optuna_script():
    spec = importlib.util.spec_from_file_location("optuna_binary_cli", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class CliDefaultsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_optuna_script()

    def test_nightly_defaults(self):
        args = self.module.parse_args([])

        self.assertEqual(args.n, 3000)
        self.assertEqual(args.trials, 20)
        self.assertEqual(args.trial_epochs, 6)
        self.assertEqual(args.final_epochs, 15)
        self.assertEqual(args.seed, 42)

    def test_rejects_non_positive_numeric_arguments(self):
        args = self.module.parse_args(["--trials", "0"])

        with self.assertRaisesRegex(ValueError, "trials"):
            self.module.validate_args(args)


class SearchAndObjectiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_optuna_script()

    def test_suggests_the_approved_search_space(self):
        fixed = {
            "learning_rate": 1e-3,
            "weight_decay": 1e-4,
            "batch_size": 32,
            "head_units": 128,
            "dropout": 0.4,
            "optimizer": "adamw",
            "freeze_ratio": 0.65,
        }

        params = self.module.suggest_parameters(optuna.trial.FixedTrial(fixed))

        self.assertEqual(params, fixed)

    def test_objective_returns_best_validation_accuracy(self):
        fixed = {
            "learning_rate": 1e-3,
            "weight_decay": 1e-4,
            "batch_size": 32,
            "head_units": 128,
            "dropout": 0.4,
            "optimizer": "adam",
            "freeze_ratio": 0.8,
        }
        datasets = []

        class FakeTrainingModule:
            @staticmethod
            def build_dataset(samples, training, batch_size):
                result = (tuple(samples), training, batch_size)
                datasets.append(result)
                return result

        class FakeModel:
            def fit(self, *args, **kwargs):
                return SimpleNamespace(
                    history={"val_accuracy": [0.61, 0.74, 0.70]}
                )

        captured = {}

        def fake_builder(**kwargs):
            captured.update(kwargs)
            return FakeModel()

        objective = self.module.make_objective(
            FakeTrainingModule,
            train_samples=[("train.jpg", 1)],
            val_samples=[("val.jpg", 0)],
            trial_epochs=3,
            model_builder=fake_builder,
            pruning_callback_factory=lambda trial, monitor: object(),
        )

        value = objective(optuna.trial.FixedTrial(fixed))

        self.assertEqual(value, 0.74)
        self.assertEqual(datasets[0][2], 32)
        self.assertEqual(datasets[1][2], 32)
        self.assertEqual(captured["head_units"], 128)
        self.assertEqual(captured["optimizer_name"], "adam")


class ExistingPipelineReuseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_optuna_script()

    def test_loads_dataset_functions_from_script_07(self):
        training = self.module.load_training_module()

        self.assertTrue(callable(training.preparar_muestras))
        self.assertTrue(callable(training.build_dataset))
        self.assertTrue(callable(training.descargar_negativos))
        self.assertTrue(callable(training.evaluar))

    def test_registers_dynamic_training_module_for_tensorflow_autograph(self):
        training = self.module.load_training_module()

        self.assertIs(sys.modules["binary_classifier_training"], training)

    def test_main_fails_cleanly_when_mtg_dataset_is_missing(self):
        training = SimpleNamespace(IMAGES_MTG=Path("missing-images"))

        with patch.object(
            self.module,
            "load_training_module",
            return_value=training,
        ):
            exit_code = self.module.main(["--trials", "1", "--no-final-train"])

        self.assertEqual(exit_code, 1)


if __name__ == "__main__":
    unittest.main()
