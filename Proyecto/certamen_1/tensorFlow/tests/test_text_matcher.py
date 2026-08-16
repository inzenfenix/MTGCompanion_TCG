"""
ROADMAP.md G1 — unit tests for src/text_matcher.py (Stage 2, TensorFlow
side). Same cases as pytorch/tests/test_text_matcher.py (Keras equivalents
for the architecture/loss checks) — build_vectorizer()/par_a_features() are
byte-identical across frameworks (CLAUDE.md rule 4), so those cases are
literally the same assertions.
"""

import numpy as np
import pytest
import tensorflow as tf

from src.text_matcher import N_FEATURES, build_optimizer, build_text_matcher, build_vectorizer, par_a_features


def test_par_a_features_returns_4x_n_features_vector():
    vectorizador = build_vectorizer()
    features = par_a_features(vectorizador, "Lightning Bolt", "Lightning Bolt")

    assert features.shape == (N_FEATURES * 4,)
    assert features.dtype == np.float32


def test_par_a_features_identical_texts_give_zero_diff_half():
    vectorizador = build_vectorizer()
    features = par_a_features(vectorizador, "Island", "Island")

    diff_half = features[2 * N_FEATURES : 3 * N_FEATURES]
    np.testing.assert_allclose(diff_half, np.zeros(N_FEATURES, dtype=np.float32))


def test_par_a_features_handles_none_and_empty_text():
    vectorizador = build_vectorizer()
    features = par_a_features(vectorizador, None, "")

    assert features.shape == (N_FEATURES * 4,)
    assert np.all(np.isfinite(features))


def test_build_vectorizer_is_deterministic_no_fit_state():
    v1, v2 = build_vectorizer(), build_vectorizer()
    out1 = v1.transform(["Sol Ring"]).toarray()
    out2 = v2.transform(["Sol Ring"]).toarray()

    np.testing.assert_array_equal(out1, out2)


class TestBuildTextMatcherArchitecture:
    def test_forward_pass_output_shape_is_batch_size(self):
        model = build_text_matcher(input_dim=N_FEATURES * 4, hidden_units=32)
        x = np.random.randn(5, N_FEATURES * 4).astype(np.float32)

        logits = model(x, training=False)

        assert logits.shape == (5, 1)

    def test_functional_api_used_not_sequential(self):
        """
        Must expose output_names (Sequential doesn't) — a real bug already
        hit once by 14_export_onnx_text_validator.py (ROADMAP.md A5), so
        this locks in the fix rather than just testing shapes.
        """
        model = build_text_matcher(hidden_units=8)
        assert hasattr(model, "output_names")

    def test_rejects_nonpositive_hidden_units(self):
        with pytest.raises(ValueError):
            build_text_matcher(hidden_units=0)

    def test_rejects_dropout_out_of_range(self):
        with pytest.raises(ValueError):
            build_text_matcher(dropout=1.5)


class TestBuildOptimizer:
    def test_adam_adamw_sgd_all_supported(self):
        for name, cls in [
            ("adam", tf.keras.optimizers.Adam),
            ("adamw", tf.keras.optimizers.AdamW),
            ("sgd", tf.keras.optimizers.SGD),
        ]:
            opt = build_optimizer(name, learning_rate=1e-3, weight_decay=1e-4)
            assert isinstance(opt, cls)

    def test_case_insensitive_and_stripped(self):
        opt = build_optimizer("  AdamW  ", learning_rate=1e-3, weight_decay=1e-4)
        assert isinstance(opt, tf.keras.optimizers.AdamW)

    def test_unknown_optimizer_raises(self):
        with pytest.raises(ValueError):
            build_optimizer("rmsprop", learning_rate=1e-3, weight_decay=1e-4)


def test_loss_decreases_on_tiny_separable_batch():
    """Same toy separable-clusters setup as the PyTorch test, fit via model.fit()."""
    tf.random.set_seed(0)
    model = build_text_matcher(hidden_units=16, dropout=0.0, learning_rate=1e-2)

    n = 32
    dim = N_FEATURES * 4
    rng = np.random.default_rng(0)
    x_pos = rng.standard_normal((n // 2, dim)).astype(np.float32) + 3.0
    x_neg = rng.standard_normal((n // 2, dim)).astype(np.float32) - 3.0
    x = np.concatenate([x_pos, x_neg])
    y = np.concatenate([np.ones(n // 2), np.zeros(n // 2)]).astype(np.float32)

    history = model.fit(x, y, epochs=20, batch_size=n, verbose=0)
    losses = history.history["loss"]

    assert losses[-1] < losses[0]
