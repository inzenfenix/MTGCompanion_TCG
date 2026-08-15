"""
Arquitectura del validador de texto (Stage 2, TensorFlow) — espejo de
../../pytorch/src/text_matcher.py. Ver ../../certamen_2/README.md, sección
"Stage 2 — Validador de texto (OCR)".

`build_vectorizer()` es IDÉNTICO al de pytorch/src/text_matcher.py (mismos
parámetros de `HashingVectorizer` — determinístico, sin `.fit()`, sin estado)
para que ambos frameworks entrenen sobre EXACTAMENTE las mismas features de
entrada (CLAUDE.md, regla 4). Lo que cambia entre frameworks es la red que
arma con esas features (acá: Keras `Sequential` en vez de `nn.Module`), no
las features en sí.

Feature del par (ocr_text, texto_referencia): concat[v_ocr, v_ref,
|v_ocr - v_ref|, v_ocr * v_ref] — igual que el lado PyTorch.
"""

from __future__ import annotations

import numpy as np
import tensorflow as tf
from sklearn.feature_extraction.text import HashingVectorizer

N_FEATURES = 512  # dim. de CADA vector de texto — el input real de la red es 4x esto (ver build_text_matcher)


def build_vectorizer() -> HashingVectorizer:
    """Mismos parámetros que pytorch/src/text_matcher.py — ver docstring de ese módulo para el porqué de cada uno."""
    return HashingVectorizer(
        analyzer="char_wb", ngram_range=(3, 5), n_features=N_FEATURES,
        alternate_sign=False, norm="l2",
    )


def par_a_features(vectorizador: HashingVectorizer, ocr_text: str, ref_text: str) -> np.ndarray:
    """Arma el vector de entrada de UN par (ocr_text, ref_text) — ver pytorch/src/text_matcher.py."""
    v_ocr = vectorizador.transform([ocr_text or ""]).toarray()[0].astype(np.float32)
    v_ref = vectorizador.transform([ref_text or ""]).toarray()[0].astype(np.float32)
    return np.concatenate([v_ocr, v_ref, np.abs(v_ocr - v_ref), v_ocr * v_ref])


def build_optimizer(name: str, learning_rate: float, weight_decay: float) -> tf.keras.optimizers.Optimizer:
    """Mismo patrón que src/condition_classifier.py."""
    normalized = name.strip().lower()
    common = {"learning_rate": learning_rate, "weight_decay": weight_decay}
    if normalized == "adam":
        return tf.keras.optimizers.Adam(**common)
    if normalized == "adamw":
        return tf.keras.optimizers.AdamW(**common)
    if normalized == "sgd":
        return tf.keras.optimizers.SGD(momentum=0.9, **common)
    raise ValueError(f"Optimizador no soportado: {name}")


def build_text_matcher(
    input_dim: int = N_FEATURES * 4,
    hidden_units: int = 256,
    dropout: float = 0.3,
    learning_rate: float = 1e-3,
    weight_decay: float = 1e-4,
    optimizer_name: str = "adamw",
) -> tf.keras.Model:
    """
    MLP sobre las features de matching de un par (ocr_text, ref_text) — mismo
    shape que TextMatcher del lado PyTorch (Linear→ReLU→Dropout ×2 →
    logit único). Sale un logit crudo (sin sigmoid); se entrena con
    `BinaryCrossentropy(from_logits=True)`, equivalente a `BCEWithLogitsLoss`.
    """
    if hidden_units <= 0:
        raise ValueError("hidden_units debe ser positivo")
    if not 0.0 <= dropout <= 1.0:
        raise ValueError("dropout debe estar entre 0.0 y 1.0")

    model = tf.keras.Sequential([
        tf.keras.Input(shape=(input_dim,)),
        tf.keras.layers.Dense(hidden_units, activation="relu"),
        tf.keras.layers.Dropout(dropout),
        tf.keras.layers.Dense(hidden_units // 2, activation="relu"),
        tf.keras.layers.Dropout(dropout),
        tf.keras.layers.Dense(1),
    ], name="text_matcher")

    model.compile(
        optimizer=build_optimizer(optimizer_name, learning_rate, weight_decay),
        loss=tf.keras.losses.BinaryCrossentropy(from_logits=True),
        # from_logits=True porque la última Dense no tiene activación (ver arriba) —
        # deja monitorear val_auc por época igual que el lado PyTorch monitorea roc_auc_score.
        metrics=[tf.keras.metrics.AUC(name="auc", from_logits=True)],
    )
    model.input_dim = input_dim
    model.hidden_units = hidden_units
    model.dropout_p = dropout
    return model
