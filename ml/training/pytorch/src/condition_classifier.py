"""
Arquitectura configurable del clasificador de condición (Stage 4, PyTorch).

Mismo patrón que src/binary_classifier.py: EfficientNet_b0 preentrenado +
cabeza propia, parametrizada para que la corrida normal y una futura búsqueda
Optuna (ver ml/data-prep/README.md, sección 0, mismo patrón que Stage 1)
entrenen exactamente la misma arquitectura. Difiere de MTGDetector en que la
cabeza tiene GRADOS salidas (clasificación multi-clase, CrossEntropyLoss) en
vez de una sola (binaria, BCEWithLogitsLoss).
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torchvision.models as models

GRADOS = ["NM", "LP", "MP", "HP", "DMG"]
FREEZE_RATIO = 0.65  # mismo default que MTGDetector — punto de partida razonable, no una elección aprendida


def build_optimizer(name: str, parametros, learning_rate: float, weight_decay: float) -> torch.optim.Optimizer:
    normalized = name.strip().lower()
    if normalized == "adam":
        return torch.optim.Adam(parametros, lr=learning_rate, weight_decay=weight_decay)
    if normalized == "adamw":
        return torch.optim.AdamW(parametros, lr=learning_rate, weight_decay=weight_decay)
    if normalized == "sgd":
        return torch.optim.SGD(parametros, lr=learning_rate, weight_decay=weight_decay, momentum=0.9)
    raise ValueError(f"Optimizador no soportado: {name}")


class ConditionGrader(nn.Module):
    """
    EfficientNet_b0 adaptado como clasificador de condición (NM/LP/MP/HP/DMG).

    Misma lógica de freeze_ratio que MTGDetector (ver src/binary_classifier.py)
    — fracción de bloques del backbone congelados desde la entrada. La cabeza
    devuelve `len(GRADOS)` logits crudos (aplicar softmax para probabilidades);
    el entrenamiento usa CrossEntropyLoss, que ya aplica softmax internamente.
    """

    def __init__(self, freeze_ratio: float = FREEZE_RATIO, head_units: int = 256, dropout: float | None = None):
        super().__init__()
        if not 0.0 <= freeze_ratio <= 1.0:
            raise ValueError("freeze_ratio debe estar entre 0.0 y 1.0")
        if head_units <= 0:
            raise ValueError("head_units debe ser positivo")
        if dropout is not None and not 0.0 <= dropout <= 1.0:
            raise ValueError("dropout debe estar entre 0.0 y 1.0")

        dropout_1, dropout_2 = (0.3, 0.2) if dropout is None else (dropout, dropout)

        base = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
        n_bloques = len(base.features)
        freeze_until = round(freeze_ratio * n_bloques)
        for i, bloque in enumerate(base.features):
            for p in bloque.parameters():
                p.requires_grad = (i >= freeze_until)

        self.features = base.features
        self.avgpool = base.avgpool
        self.flatten = nn.Flatten()
        self.head = nn.Sequential(
            nn.Dropout(dropout_1),
            nn.Linear(1280, head_units),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout_2),
            nn.Linear(head_units, len(GRADOS)),
        )

        self.freeze_ratio = freeze_ratio
        self.freeze_until = freeze_until
        self.head_units = head_units

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.flatten(self.avgpool(self.features(x)))  # (B, 1280)
        return self.head(h)  # (B, len(GRADOS)) logits crudos


def build_condition_grader(
    freeze_ratio: float = FREEZE_RATIO,
    learning_rate: float = 3e-4,
    weight_decay: float = 1e-4,
    head_units: int = 256,
    dropout: float | None = None,
    optimizer_name: str = "adamw",
    device: str = "cpu",
) -> tuple[ConditionGrader, torch.optim.Optimizer]:
    model = ConditionGrader(freeze_ratio=freeze_ratio, head_units=head_units, dropout=dropout).to(device)
    optimizer = build_optimizer(
        optimizer_name,
        filter(lambda p: p.requires_grad, model.parameters()),
        learning_rate,
        weight_decay,
    )
    return model, optimizer
