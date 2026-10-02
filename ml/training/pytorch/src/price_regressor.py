"""
Cabeza de regresión de Stage 3 (estimador de precio, PyTorch) — MLP sobre
concat(x_tab, x_vis) (ver ../../../data-prep/README.md, sección 5.1.1).
Mismo shape que src/text_matcher.py::TextMatcher (Linear→ReLU→Dropout ×2 →
salida única) pero para regresión: predice log1p(price) en vez de un logit
de clasificación binaria.

Separar el builder del script de entrenamiento (15_price_estimator.py) sigue
el mismo criterio que src/binary_classifier.py / src/condition_classifier.py:
permite que un futuro script de Optuna reuse exactamente la misma
arquitectura sin duplicar la definición del modelo.
"""

from __future__ import annotations

import torch
import torch.nn as nn


def build_optimizer(name: str, parametros, learning_rate: float, weight_decay: float) -> torch.optim.Optimizer:
    normalized = name.strip().lower()
    if normalized == "adam":
        return torch.optim.Adam(parametros, lr=learning_rate, weight_decay=weight_decay)
    if normalized == "adamw":
        return torch.optim.AdamW(parametros, lr=learning_rate, weight_decay=weight_decay)
    if normalized == "sgd":
        return torch.optim.SGD(parametros, lr=learning_rate, weight_decay=weight_decay, momentum=0.9)
    raise ValueError(f"Optimizador no soportado: {name}")


class PriceRegressor(nn.Module):
    """MLP sobre concat(x_tab, x_vis) — ver docstring del módulo."""

    def __init__(self, input_dim: int, hidden_units: int = 256, dropout: float = 0.3):
        super().__init__()
        if input_dim <= 0:
            raise ValueError("input_dim debe ser positivo")
        if hidden_units <= 0:
            raise ValueError("hidden_units debe ser positivo")
        if not 0.0 <= dropout <= 1.0:
            raise ValueError("dropout debe estar entre 0.0 y 1.0")

        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_units),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(hidden_units, hidden_units // 2),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(hidden_units // 2, 1),
        )
        self.input_dim = input_dim
        self.hidden_units = hidden_units
        self.dropout_p = dropout

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)  # (B,) log1p(price) predicho


def build_price_regressor(
    input_dim: int,
    hidden_units: int = 256,
    dropout: float = 0.3,
    learning_rate: float = 1e-3,
    weight_decay: float = 1e-4,
    optimizer_name: str = "adamw",
    device: str = "cpu",
) -> tuple[PriceRegressor, torch.optim.Optimizer]:
    model = PriceRegressor(input_dim=input_dim, hidden_units=hidden_units, dropout=dropout).to(device)
    optimizer = build_optimizer(optimizer_name, model.parameters(), learning_rate, weight_decay)
    return model, optimizer
