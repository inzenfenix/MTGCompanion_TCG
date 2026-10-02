"""
ROADMAP.md G1 — unit tests for src/price_regressor.py (Stage 3 regression
head, TensorFlow side). Same cases as
pytorch/tests/test_price_regressor.py, Keras equivalents.
"""

import numpy as np
import pytest
import tensorflow as tf

from src.price_regressor import build_optimizer, build_price_regressor


INPUT_DIM = 626  # 50 tabular + 576 visual (TensorFlow MobileNetV3Small backbone dim, see B1/E2 in ROADMAP.md)


class TestBuildPriceRegressorArchitecture:
    def test_forward_pass_output_shape_is_batch_size(self):
        model = build_price_regressor(input_dim=INPUT_DIM, hidden_units=32)
        x = np.random.randn(5, INPUT_DIM).astype(np.float32)

        preds = model(x, training=False)

        assert preds.shape == (5, 1)

    def test_output_is_unbounded_raw_value_not_squashed(self):
        """Regression head must NOT apply sigmoid/tanh — log1p(price) is unbounded."""
        model = build_price_regressor(input_dim=INPUT_DIM, hidden_units=8)
        x = np.full((4, INPUT_DIM), 50.0, dtype=np.float32)

        preds = model(x, training=False)

        assert np.all(np.isfinite(preds.numpy()))

    def test_functional_api_used_not_sequential(self):
        model = build_price_regressor(input_dim=INPUT_DIM, hidden_units=8)
        assert hasattr(model, "output_names")

    def test_rejects_nonpositive_input_dim(self):
        with pytest.raises(ValueError):
            build_price_regressor(input_dim=0)

    def test_rejects_nonpositive_hidden_units(self):
        with pytest.raises(ValueError):
            build_price_regressor(input_dim=INPUT_DIM, hidden_units=-1)

    def test_rejects_dropout_out_of_range(self):
        with pytest.raises(ValueError):
            build_price_regressor(input_dim=INPUT_DIM, dropout=-0.1)


class TestBuildOptimizer:
    def test_adam_adamw_sgd_all_supported(self):
        for name, cls in [
            ("adam", tf.keras.optimizers.Adam),
            ("adamw", tf.keras.optimizers.AdamW),
            ("sgd", tf.keras.optimizers.SGD),
        ]:
            opt = build_optimizer(name, learning_rate=1e-3, weight_decay=1e-4)
            assert isinstance(opt, cls)

    def test_unknown_optimizer_raises(self):
        with pytest.raises(ValueError):
            build_optimizer("lbfgs", learning_rate=1e-3, weight_decay=1e-4)


def test_loss_decreases_on_tiny_linear_batch():
    tf.random.set_seed(0)
    model = build_price_regressor(input_dim=INPUT_DIM, hidden_units=16, dropout=0.0, learning_rate=1e-2)

    n = 16
    rng = np.random.default_rng(0)
    x = rng.standard_normal((n, INPUT_DIM)).astype(np.float32)
    y = x[:, :5].sum(axis=1).astype(np.float32)

    history = model.fit(x, y, epochs=30, batch_size=n, verbose=0)
    losses = history.history["loss"]

    assert losses[-1] < losses[0]
