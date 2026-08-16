"""
ROADMAP.md G1 — unit tests for src/text_matcher.py (Stage 2, PyTorch side).
Architecture shape + forward-pass shape + a tiny loss-decreasing smoke test,
same spirit as the manual synthetic-data checks already done during dev
(see A3 in ROADMAP.md), just formalized into pytest. Mirrored byte-for-byte
in tensorFlow/tests/test_text_matcher.py (same cases, Keras equivalents).
"""

import numpy as np
import pytest
import torch

from src.text_matcher import N_FEATURES, TextMatcher, build_optimizer, build_text_matcher, build_vectorizer, par_a_features


def test_par_a_features_returns_4x_n_features_vector():
    vectorizador = build_vectorizer()
    features = par_a_features(vectorizador, "Lightning Bolt", "Lightning Bolt")

    assert features.shape == (N_FEATURES * 4,)
    assert features.dtype == np.float32


def test_par_a_features_identical_texts_give_zero_diff_half():
    """|v_ocr - v_ref| (the 3rd quarter of the feature vector) is all-zero when ocr_text == ref_text."""
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
    """Two independently-built vectorizers must produce identical output — no persisted/fitted state (CLAUDE.md rule 4)."""
    v1, v2 = build_vectorizer(), build_vectorizer()
    out1 = v1.transform(["Sol Ring"]).toarray()
    out2 = v2.transform(["Sol Ring"]).toarray()

    np.testing.assert_array_equal(out1, out2)


class TestTextMatcherArchitecture:
    def test_forward_pass_output_shape_is_batch_size(self):
        model = TextMatcher(input_dim=N_FEATURES * 4, hidden_units=32)
        x = torch.randn(5, N_FEATURES * 4)

        logits = model(x)

        assert logits.shape == (5,)

    def test_forward_pass_single_example(self):
        model = TextMatcher(input_dim=N_FEATURES * 4, hidden_units=32)
        x = torch.randn(1, N_FEATURES * 4)

        logits = model(x)

        assert logits.shape == (1,)

    def test_rejects_nonpositive_hidden_units(self):
        with pytest.raises(ValueError):
            TextMatcher(hidden_units=0)

    def test_rejects_dropout_out_of_range(self):
        with pytest.raises(ValueError):
            TextMatcher(dropout=1.5)


class TestBuildOptimizer:
    def test_adam_adamw_sgd_all_supported(self):
        model = TextMatcher(hidden_units=8)
        for name, cls in [("adam", torch.optim.Adam), ("adamw", torch.optim.AdamW), ("sgd", torch.optim.SGD)]:
            opt = build_optimizer(name, model.parameters(), learning_rate=1e-3, weight_decay=1e-4)
            assert isinstance(opt, cls)

    def test_case_insensitive_and_stripped(self):
        model = TextMatcher(hidden_units=8)
        opt = build_optimizer("  AdamW  ", model.parameters(), learning_rate=1e-3, weight_decay=1e-4)
        assert isinstance(opt, torch.optim.AdamW)

    def test_unknown_optimizer_raises(self):
        model = TextMatcher(hidden_units=8)
        with pytest.raises(ValueError):
            build_optimizer("rmsprop", model.parameters(), learning_rate=1e-3, weight_decay=1e-4)


def test_loss_decreases_on_tiny_separable_batch():
    """
    Not a real training run — just confirms the model+optimizer wiring
    actually learns something on an easy, perfectly-separable toy batch
    (same spirit as the synthetic-data sanity checks A3 already did by hand).
    """
    torch.manual_seed(0)
    model, optimizer = build_text_matcher(hidden_units=16, dropout=0.0, learning_rate=1e-2)
    criterion = torch.nn.BCEWithLogitsLoss()

    # Two well-separated clusters in feature space, trivially linearly separable.
    n = 32
    dim = N_FEATURES * 4
    x_pos = torch.randn(n // 2, dim) + 3.0
    x_neg = torch.randn(n // 2, dim) - 3.0
    x = torch.cat([x_pos, x_neg])
    y = torch.cat([torch.ones(n // 2), torch.zeros(n // 2)])

    model.train()
    losses = []
    for _ in range(20):
        optimizer.zero_grad()
        logits = model(x)
        loss = criterion(logits, y)
        loss.backward()
        optimizer.step()
        losses.append(loss.item())

    assert losses[-1] < losses[0]
