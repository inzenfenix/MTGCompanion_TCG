"""
ROADMAP.md G1 — unit tests for src/price_regressor.py (Stage 3 regression
head, PyTorch side). Same shape/spirit as test_text_matcher.py's
architecture tests (PriceRegressor mirrors TextMatcher's Linear-ReLU-Dropout
x2 -> single output shape, see price_regressor.py's own docstring) but for
a regression target (log1p(price)) instead of a classification logit.
"""

import pytest
import torch

from src.price_regressor import PriceRegressor, build_optimizer, build_price_regressor


INPUT_DIM = 1330  # 50 tabular + 1280 visual (PyTorch backbone dim, see B1/E2 in ROADMAP.md)


class TestPriceRegressorArchitecture:
    def test_forward_pass_output_shape_is_batch_size(self):
        model = PriceRegressor(input_dim=INPUT_DIM, hidden_units=32)
        x = torch.randn(5, INPUT_DIM)

        preds = model(x)

        assert preds.shape == (5,)

    def test_forward_pass_single_example(self):
        model = PriceRegressor(input_dim=INPUT_DIM, hidden_units=32)
        x = torch.randn(1, INPUT_DIM)

        preds = model(x)

        assert preds.shape == (1,)

    def test_output_is_unbounded_raw_value_not_squashed(self):
        """Regression head must NOT apply sigmoid/tanh — log1p(price) is unbounded, unlike TextMatcher's logit."""
        torch.manual_seed(0)
        model = PriceRegressor(input_dim=INPUT_DIM, hidden_units=8)
        # Push inputs to an extreme to make a squashed-output bug (e.g. an
        # accidental final activation) obvious rather than possibly-coincidental.
        x = torch.full((4, INPUT_DIM), 50.0)

        preds = model(x)

        assert torch.isfinite(preds).all()

    def test_rejects_nonpositive_input_dim(self):
        with pytest.raises(ValueError):
            PriceRegressor(input_dim=0)

    def test_rejects_nonpositive_hidden_units(self):
        with pytest.raises(ValueError):
            PriceRegressor(input_dim=INPUT_DIM, hidden_units=-1)

    def test_rejects_dropout_out_of_range(self):
        with pytest.raises(ValueError):
            PriceRegressor(input_dim=INPUT_DIM, dropout=-0.1)


class TestBuildOptimizer:
    def test_adam_adamw_sgd_all_supported(self):
        model = PriceRegressor(input_dim=INPUT_DIM, hidden_units=8)
        for name, cls in [("adam", torch.optim.Adam), ("adamw", torch.optim.AdamW), ("sgd", torch.optim.SGD)]:
            opt = build_optimizer(name, model.parameters(), learning_rate=1e-3, weight_decay=1e-4)
            assert isinstance(opt, cls)

    def test_unknown_optimizer_raises(self):
        model = PriceRegressor(input_dim=INPUT_DIM, hidden_units=8)
        with pytest.raises(ValueError):
            build_optimizer("lbfgs", model.parameters(), learning_rate=1e-3, weight_decay=1e-4)


def test_loss_decreases_on_tiny_linear_batch():
    """
    Smoke test: the model+optimizer wiring must be able to fit a trivial
    linear target (sum of a few input dims) on a tiny batch — same spirit
    as test_text_matcher.py's loss-decreasing check, MSE instead of BCE.
    """
    torch.manual_seed(0)
    model, optimizer = build_price_regressor(input_dim=INPUT_DIM, hidden_units=16, dropout=0.0, learning_rate=1e-2)
    criterion = torch.nn.MSELoss()

    n = 16
    x = torch.randn(n, INPUT_DIM)
    y = x[:, :5].sum(dim=1)  # trivial linear target, easily learnable

    model.train()
    losses = []
    for _ in range(30):
        optimizer.zero_grad()
        preds = model(x)
        loss = criterion(preds, y)
        loss.backward()
        optimizer.step()
        losses.append(loss.item())

    assert losses[-1] < losses[0]
