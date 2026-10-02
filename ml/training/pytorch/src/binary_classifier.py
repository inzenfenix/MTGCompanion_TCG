"""
Arquitectura configurable del clasificador binario MTG/no-MTG (PyTorch).

Espejo de tensorFlow/src/binary_classifier.py: separar el builder del
script de entrenamiento permite que 07_binary_classifier.py (corrida normal,
hiperparámetros por defecto) y 08_optuna_binary_classifier.py (búsqueda) usen
exactamente la misma arquitectura, sin duplicar la definición del modelo.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torchvision.models as models

FREEZE_RATIO = 0.65  # fracción de bloques del backbone EfficientNet_b0 que quedan congelados (desde la entrada)


def build_optimizer(
    name: str,
    parametros,
    learning_rate: float,
    weight_decay: float,
) -> torch.optim.Optimizer:
    """Construye uno de los optimizadores incluidos en el estudio Optuna."""
    normalized = name.strip().lower()
    if normalized == "adam":
        return torch.optim.Adam(parametros, lr=learning_rate, weight_decay=weight_decay)
    if normalized == "adamw":
        return torch.optim.AdamW(parametros, lr=learning_rate, weight_decay=weight_decay)
    if normalized == "sgd":
        return torch.optim.SGD(parametros, lr=learning_rate, weight_decay=weight_decay, momentum=0.9)
    raise ValueError(f"Optimizador no soportado: {name}")


class MTGDetector(nn.Module):
    """
    EfficientNet_b0 adaptado como clasificador binario MTG / no-MTG, con
    cabeza e hiperparámetros configurables para la búsqueda Optuna.

    `freeze_ratio` congela la fracción indicada de bloques del backbone desde
    la entrada — mismo criterio que MobileNetV2 en TensorFlow (fracción de
    capas), traducido acá a un índice de bloque entero: EfficientNet_b0 tiene
    9 bloques (features[0]..features[8]), así que freeze_ratio=0.65 congela
    round(0.65 * 9) = 6 bloques, el mismo default que tenía el FREEZE_UNTIL
    hardcodeado original.

    `dropout=None` conserva la cabeza histórica (Dropout 0.3 y 0.2). Un valor
    numérico aplica la misma tasa a ambos Dropout durante la búsqueda.
    """

    def __init__(
        self,
        freeze_ratio: float = FREEZE_RATIO,
        head_units: int = 256,
        dropout: float | None = None,
    ):
        super().__init__()
        if not 0.0 <= freeze_ratio <= 1.0:
            raise ValueError("freeze_ratio debe estar entre 0.0 y 1.0")
        if head_units <= 0:
            raise ValueError("head_units debe ser positivo")
        if dropout is not None and not 0.0 <= dropout <= 1.0:
            raise ValueError("dropout debe estar entre 0.0 y 1.0")

        dropout_1, dropout_2 = (0.3, 0.2) if dropout is None else (dropout, dropout)

        base = models.efficientnet_b0(
            weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1
        )
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
            nn.Linear(head_units, 1),
        )

        self.freeze_ratio = freeze_ratio
        self.freeze_until = freeze_until
        self.head_units = head_units

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.flatten(self.avgpool(self.features(x)))  # (B, 1280)
        return self.head(h).squeeze(1)                    # (B,) logits


def build_binary_classifier(
    freeze_ratio: float = FREEZE_RATIO,
    learning_rate: float = 3e-4,
    weight_decay: float = 1e-4,
    head_units: int = 256,
    dropout: float | None = None,
    optimizer_name: str = "adamw",
    device: str = "cpu",
) -> tuple[MTGDetector, torch.optim.Optimizer]:
    """Construye el modelo + su optimizador (solo sobre parámetros entrenables)."""
    model = MTGDetector(freeze_ratio=freeze_ratio, head_units=head_units, dropout=dropout).to(device)
    optimizer = build_optimizer(
        optimizer_name,
        filter(lambda p: p.requires_grad, model.parameters()),
        learning_rate,
        weight_decay,
    )
    return model, optimizer
