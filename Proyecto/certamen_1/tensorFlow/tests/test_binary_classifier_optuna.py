import unittest
from unittest.mock import patch

import tensorflow as tf

from src.binary_classifier import build_binary_classifier, build_optimizer


def fake_backbone(*args, **kwargs):
    inputs = tf.keras.Input(shape=(224, 224, 3))
    x = tf.keras.layers.GlobalAveragePooling2D()(inputs)
    outputs = tf.keras.layers.Dense(8)(x)
    return tf.keras.Model(inputs, outputs, name="fake_backbone")


class OptimizerFactoryTests(unittest.TestCase):
    def test_builds_supported_optimizers(self):
        self.assertIsInstance(
            build_optimizer("adam", 1e-3, 1e-5),
            tf.keras.optimizers.Adam,
        )
        self.assertIsInstance(
            build_optimizer("adamw", 1e-3, 1e-5),
            tf.keras.optimizers.AdamW,
        )
        self.assertIsInstance(
            build_optimizer("sgd", 1e-3, 1e-5),
            tf.keras.optimizers.SGD,
        )

    def test_rejects_unknown_optimizer(self):
        with self.assertRaisesRegex(ValueError, "Optimizador no soportado"):
            build_optimizer("rmsprop", 1e-3, 0.0)


class BinaryClassifierBuilderTests(unittest.TestCase):
    @patch(
        "src.binary_classifier.tf.keras.applications.MobileNetV3Small",
        side_effect=fake_backbone,
    )
    def test_defaults_keep_existing_head(self, _mock):
        model = build_binary_classifier()
        dense = [
            layer for layer in model.layers
            if isinstance(layer, tf.keras.layers.Dense)
        ]
        dropout = [
            layer.rate for layer in model.layers
            if isinstance(layer, tf.keras.layers.Dropout)
        ]

        self.assertEqual(dense[-2].units, 256)
        self.assertEqual(dropout, [0.3, 0.2])
        self.assertIsInstance(model.optimizer, tf.keras.optimizers.Adam)

    @patch(
        "src.binary_classifier.tf.keras.applications.MobileNetV3Small",
        side_effect=fake_backbone,
    )
    def test_applies_trial_head_parameters(self, _mock):
        model = build_binary_classifier(
            head_units=128,
            dropout=0.4,
            optimizer_name="sgd",
            learning_rate=1e-3,
            weight_decay=1e-4,
        )
        dense = [
            layer for layer in model.layers
            if isinstance(layer, tf.keras.layers.Dense)
        ]
        dropout = [
            layer.rate for layer in model.layers
            if isinstance(layer, tf.keras.layers.Dropout)
        ]

        self.assertEqual(dense[-2].units, 128)
        self.assertEqual(dropout, [0.4, 0.4])
        self.assertIsInstance(model.optimizer, tf.keras.optimizers.SGD)

    def test_rejects_invalid_hyperparameters(self):
        with self.assertRaisesRegex(ValueError, "freeze_ratio"):
            build_binary_classifier(freeze_ratio=1.1)
        with self.assertRaisesRegex(ValueError, "head_units"):
            build_binary_classifier(head_units=0)
        with self.assertRaisesRegex(ValueError, "dropout"):
            build_binary_classifier(dropout=-0.1)


if __name__ == "__main__":
    unittest.main()
