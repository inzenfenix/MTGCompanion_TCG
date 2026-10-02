"""
Arquitectura del validador de texto (Stage 2, PyTorch) — ver
../../data-prep/README.md, sección "Stage 2 — Validador de texto (OCR)".

A diferencia de Stage 1/4 (que parten de un backbone de imágenes preentrenado,
transfer learning), acá no hay nada preentrenado que reusar: es texto corto de
cartas (nombre + oracle_text), no hay ningún backbone de lenguaje en el resto
del proyecto. La red arranca desde cero sobre features léxicas clásicas —
bag-of-character-n-gramas hasheado (mismo truco que usan
sklearn.HashingVectorizer / fastText / Vowpal Wabbit para evitar mantener un
vocabulario y un artefacto de vectorizador "fiteado" que haya que versionar).

`HashingVectorizer` es puramente determinístico (murmurhash3 con seed fija,
sin `.fit()`, sin estado) — por eso alcanza con instanciarlo igual acá y en
tensorFlow/src/text_matcher.py para garantizar que ambos frameworks entrenen
sobre EXACTAMENTE las mismas features de entrada. Lo que cambia entre
frameworks es la red que arma con esas features, no las features en sí — así
la comparación de la sección 2 del README es justa.

Feature del par (ocr_text, texto_referencia): concat[v_ocr, v_ref,
|v_ocr - v_ref|, v_ocr * v_ref] — patrón estándar de "matching network"
(mismo espíritu que ESIM/InferSent): la resta captura divergencia léxica, el
producto captura qué n-gramas aparecen en ambos.
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
from sklearn.feature_extraction.text import HashingVectorizer

N_FEATURES = 512  # dim. de CADA vector de texto — el input real de la red es 4x esto (ver TextMatcher)


def build_vectorizer() -> HashingVectorizer:
    """
    Vectorizador de texto compartido — determinístico, sin fit. `char_wb`
    (n-gramas de caracteres respetando límites de palabra) tolera mejor los
    typos/ruido típicos de OCR que un vectorizador por palabra completa.
    `alternate_sign=False` deja las features siempre >= 0 (más fácil de
    interpretar para la red que signos alternados); `norm="l2"` normaliza por
    largo de texto, para que un OCR corto y uno largo queden en escala
    comparable.
    """
    return HashingVectorizer(
        analyzer="char_wb", ngram_range=(3, 5), n_features=N_FEATURES,
        alternate_sign=False, norm="l2",
    )


def par_a_features(vectorizador: HashingVectorizer, ocr_text: str, ref_text: str) -> np.ndarray:
    """
    Arma el vector de entrada de UN par (ocr_text, ref_text) — pensado para
    inferencia de a un par por vez (ej. un futuro predict_text.py, mismo
    espíritu que pytorch/predict_condition.py). El entrenamiento (ver
    14_text_validator.py) vectoriza en batch en vez de llamar esto por fila —
    mismo resultado, mucho más rápido sobre un dataset entero.
    """
    v_ocr = vectorizador.transform([ocr_text or ""]).toarray()[0].astype(np.float32)
    v_ref = vectorizador.transform([ref_text or ""]).toarray()[0].astype(np.float32)
    return np.concatenate([v_ocr, v_ref, np.abs(v_ocr - v_ref), v_ocr * v_ref])


def build_optimizer(name: str, parametros, learning_rate: float, weight_decay: float) -> torch.optim.Optimizer:
    normalized = name.strip().lower()
    if normalized == "adam":
        return torch.optim.Adam(parametros, lr=learning_rate, weight_decay=weight_decay)
    if normalized == "adamw":
        return torch.optim.AdamW(parametros, lr=learning_rate, weight_decay=weight_decay)
    if normalized == "sgd":
        return torch.optim.SGD(parametros, lr=learning_rate, weight_decay=weight_decay, momentum=0.9)
    raise ValueError(f"Optimizador no soportado: {name}")


class TextMatcher(nn.Module):
    """MLP sobre las features de matching de un par (ocr_text, ref_text) — ver docstring del módulo."""

    def __init__(self, input_dim: int = N_FEATURES * 4, hidden_units: int = 256, dropout: float = 0.3):
        super().__init__()
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
        return self.net(x).squeeze(-1)  # (B,) logits crudos — BCEWithLogitsLoss aplica sigmoid internamente


def build_text_matcher(
    hidden_units: int = 256,
    dropout: float = 0.3,
    learning_rate: float = 1e-3,
    weight_decay: float = 1e-4,
    optimizer_name: str = "adamw",
    device: str = "cpu",
) -> tuple[TextMatcher, torch.optim.Optimizer]:
    model = TextMatcher(hidden_units=hidden_units, dropout=dropout).to(device)
    optimizer = build_optimizer(optimizer_name, model.parameters(), learning_rate, weight_decay)
    return model, optimizer
