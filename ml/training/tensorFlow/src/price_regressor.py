"""
Cabeza de regresión de Stage 3 (estimador de precio, TensorFlow) — espejo de
../../pytorch/src/price_regressor.py. MLP sobre concat(x_tab, x_vis) (ver
../../../data-prep/README.md, sección 5.1.1), prediciendo log1p(price).

API funcional (no Sequential) — mismo motivo que src/text_matcher.py:
Sequential no expone `output_names`, lo que rompe tf2onnx al exportar más
adelante (ver 14_export_onnx_text_validator.py, que ya tuvo que migrar por
esto mismo).
"""

from __future__ import annotations

import tensorflow as tf


def build_optimizer(name: str, learning_rate: float, weight_decay: float) -> tf.keras.optimizers.Optimizer:
    """Mismo patrón que src/text_matcher.py / src/condition_classifier.py."""
    normalized = name.strip().lower()
    common = {"learning_rate": learning_rate, "weight_decay": weight_decay}
    if normalized == "adam":
        return tf.keras.optimizers.Adam(**common)
    if normalized == "adamw":
        return tf.keras.optimizers.AdamW(**common)
    if normalized == "sgd":
        return tf.keras.optimizers.SGD(momentum=0.9, **common)
    raise ValueError(f"Optimizador no soportado: {name}")


def build_price_regressor(
    input_dim: int,
    hidden_units: int = 256,
    dropout: float = 0.3,
    learning_rate: float = 1e-3,
    weight_decay: float = 1e-4,
    optimizer_name: str = "adamw",
) -> tf.keras.Model:
    """MLP sobre concat(x_tab, x_vis) — mismo shape que PriceRegressor del
    lado PyTorch (Dense→ReLU→Dropout ×2 → salida única, sin activación)."""
    if input_dim <= 0:
        raise ValueError("input_dim debe ser positivo")
    if hidden_units <= 0:
        raise ValueError("hidden_units debe ser positivo")
    if not 0.0 <= dropout <= 1.0:
        raise ValueError("dropout debe estar entre 0.0 y 1.0")

    inputs = tf.keras.Input(shape=(input_dim,))
    x = tf.keras.layers.Dense(hidden_units, activation="relu")(inputs)
    x = tf.keras.layers.Dropout(dropout)(x)
    x = tf.keras.layers.Dense(hidden_units // 2, activation="relu")(x)
    x = tf.keras.layers.Dropout(dropout)(x)
    outputs = tf.keras.layers.Dense(1)(x)  # sin activación: predice log1p(price) directo
    model = tf.keras.Model(inputs, outputs, name="price_regressor")

    model.compile(
        optimizer=build_optimizer(optimizer_name, learning_rate, weight_decay),
        loss="mse",
        metrics=["mae"],
    )
    model.input_dim = input_dim
    model.hidden_units = hidden_units
    model.dropout_p = dropout
    return model
