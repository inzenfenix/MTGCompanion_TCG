"""
Vectorizador tabular compartido para Stage 3 (estimador de precio) — ver
../../../certamen_2/README.md, sección "5.1.1 Diseño del feature vector
combinado — Stage 3 'de verdad'".

Deliberadamente Python puro (sin torch/tf/sklearn) para poder importarse
tanto desde certamen_2/prepare_price_dataset.py (que no tiene ningún
framework de ML instalado, es el venv liviano compartido) como desde los
dos scripts de entrenamiento — mismo criterio que text_matcher.py con
HashingVectorizer (CLAUDE.md regla 4), pero acá el "sin .fit()" se logra con
vocabularios fijos hardcodeados + bucket "other" en vez de un
`OneHotEncoder` de sklearn (que sí tiene estado que fitear y persistir).

Este módulo está duplicado byte-idéntico en pytorch/src/ y tensorFlow/src/
— no centralizado en certamen_2/, mismo motivo que text_matcher.py: cada
script de entrenamiento importa `from src.price_features import ...`
relativo a su propio directorio (pytorch/ o tensorFlow/), sin depender de
que el otro framework esté instalado.

Reusa el feature set de certamen_2/price_estimator_baseline.py::fila_features()
pero reemplaza el OneHotEncoder fiteado de sklearn por vocabularios fijos —
los 4 vocabularios de abajo se sacaron de un Counter real sobre los 58,679
registros de cards.json (15 ago) y hoy son exhaustivos; el bucket "other" es
solo defensivo para cuando Scryfall agregue una rareza/set_type/frame nuevo,
y para que el vector no cambie de forma si algún día se filtra el dataset
distinto.

ROADMAP.md B6 (15 ago): agregadas `edhrec_rank_conocido`/`edhrec_rank_log` —
ninguno de los campos originales captura demanda/popularidad (dos cartas con
la misma rareza/set_type/frame pueden diferir en precio por órdenes de
magnitud porque una se juega en Commander y la otra no), y el Optuna sweep
de B4 plateaba en R²(log-USD) ~0.44 con train loss todavía bajando — señal
de techo de información, no de falta de tuning. `edhrec_rank` (más bajo =
más popular; viene de certamen_1/merge_edhrec_rank.py, que lo agrega a
cards.json por separado) no está disponible para toda carta, de ahí el flag
de "conocido" — mismo patrón de imputación-con-indicador que evita que un
placeholder se confunda con una señal real.
"""

from __future__ import annotations

import datetime
import math

ANIO_ACTUAL = datetime.date.today().year

COLORES = ["W", "U", "B", "R", "G"]
TIPOS_PRIMARIOS = [
    "Creature", "Instant", "Sorcery", "Artifact", "Enchantment",
    "Land", "Planeswalker", "Battle", "Kindred", "Tribal",
]

# Vocabularios fijos + "other" — orden fijo, NUNCA se reordena (movería la
# posición de las columnas one-hot en vectores/artefactos ya cacheados).
RARITY_VOCAB = ("common", "uncommon", "rare", "mythic", "special", "bonus")
SET_TYPE_VOCAB = ("expansion", "masters", "commander", "draft_innovation", "core")
FRAME_VOCAB = ("2015", "2003", "1997", "1993", "future")
BORDER_COLOR_VOCAB = ("black", "borderless", "white", "yellow")

# Las 11 columnas numéricas/binarias sin encoding, en el orden en que se
# emiten — NUMERIC_INDICES (más abajo) apunta posiciones acá.
_CAMPOS_BASE = [
    "cmc", "n_colores", "es_incoloro", "es_legendaria", "n_frame_effects",
    "tiene_foil", "tiene_etched", "anio", "antiguedad_anios",
    "edhrec_rank_conocido", "edhrec_rank_log",
]
# Subconjunto sin acotar (los otros 5 de _CAMPOS_BASE ya son 0/1) — se
# estandarizan con media/desvío calculados una vez sobre el split de train
# (ver certamen_2/prepare_price_dataset.py y
# certamen_2/data/price_dataset/tabular_scaler.json). edhrec_rank_log entra acá
# también (aunque su placeholder de "desconocido" ya es 0.0, ver
# raw_card_fields()) para que quede en la misma escala que el resto — el flag
# edhrec_rank_conocido es el que le dice al modelo si ese 0.0 es una carta
# real de rank bajísimo o simplemente "no sabemos".
NUMERIC_FIELDS = ["cmc", "n_colores", "n_frame_effects", "anio", "antiguedad_anios", "edhrec_rank_log"]
NUMERIC_INDICES = [_CAMPOS_BASE.index(f) for f in NUMERIC_FIELDS]

FEATURE_NAMES = (
    list(_CAMPOS_BASE)
    + [f"color_{c}" for c in COLORES]
    + [f"tipo_{t.lower()}" for t in TIPOS_PRIMARIOS]
    + [f"rarity_{v}" for v in RARITY_VOCAB] + ["rarity_other"]
    + [f"set_type_{v}" for v in SET_TYPE_VOCAB] + ["set_type_other"]
    + [f"frame_{v}" for v in FRAME_VOCAB] + ["frame_other"]
    + [f"border_color_{v}" for v in BORDER_COLOR_VOCAB] + ["border_color_other"]
)
N_TAB_FEATURES = len(FEATURE_NAMES)  # 50: 11 + 15 (5 colores + 10 tipos) + 24 (7+6+6+5 categóricas)


def _onehot_fijo(valor: str, vocab: tuple[str, ...]) -> list[float]:
    """One-hot con vocabulario fijo + bucket 'other' al final (len(vocab) + 1 dims)."""
    v = [0.0] * (len(vocab) + 1)
    try:
        v[vocab.index(valor)] = 1.0
    except ValueError:
        v[-1] = 1.0  # valor no visto en el vocabulario fijo -> "other"
    return v


def raw_card_fields(card: dict) -> dict:
    """
    Aplana una carta (registro crudo de cards.json) a sus campos base (sin
    one-hot, sin escalar) — mismo shape que
    certamen_2/price_estimator_baseline.py::fila_features(), para que
    certamen_2/prepare_price_dataset.py pueda volcar estos campos a un CSV
    intermedio (cards.csv) sin más dependencia de este módulo que ser Python
    puro.
    """
    type_line = card.get("type_line") or ""
    colors = card.get("colors") or []
    color_identity = card.get("color_identity") or []
    finishes = card.get("finishes") or []
    frame_effects = card.get("frame_effects") or []
    released_at = card.get("released_at") or ""
    anio_str = released_at[:4]
    anio = int(anio_str) if anio_str.isdigit() else None

    # edhrec_rank: más bajo = más popular. No toda carta lo tiene (cards.json
    # solo lo trae si certamen_1/merge_edhrec_rank.py ya corrió, y ni así
    # cubre el 100% — ver ese script). Placeholder 0.0 cuando no se conoce +
    # flag "conocido" en vez de imputar con la media, para no depender de
    # tener que recalcular ese promedio acá (ya lo hace tabular_scaler.json
    # de forma consistente sobre el resto de los campos numéricos).
    edhrec_rank = card.get("edhrec_rank")

    fila = {
        "cmc": card.get("cmc") or 0,
        "rarity": card.get("rarity") or "unknown",
        "set_type": card.get("set_type") or "unknown",
        "frame": str(card.get("frame") or "unknown"),
        "border_color": card.get("border_color") or "unknown",
        "n_colores": len(color_identity),
        "es_incoloro": int(len(colors) == 0),
        "es_legendaria": int("Legendary" in type_line),
        "n_frame_effects": len(frame_effects),
        "tiene_foil": int("foil" in finishes),
        "tiene_etched": int("etched" in finishes),
        "anio": anio if anio is not None else 2000,
        "antiguedad_anios": (ANIO_ACTUAL - anio) if anio is not None else 25,
        "edhrec_rank_conocido": int(edhrec_rank is not None),
        "edhrec_rank_log": math.log1p(edhrec_rank) if edhrec_rank is not None else 0.0,
    }
    for color in COLORES:
        fila[f"color_{color}"] = int(color in colors)
    for tipo in TIPOS_PRIMARIOS:
        fila[f"tipo_{tipo.lower()}"] = int(tipo in type_line)
    return fila


def build_tabular_vector(raw: dict) -> list[float]:
    """
    `raw` (lo que devuelve raw_card_fields(), o una fila ya leída de
    cards.csv con los mismos nombres de columna) -> vector de N_TAB_FEATURES
    dims (50, ver FEATURE_NAMES), orden fijo. Sin escalar: los 6 campos
    numéricos sin acotar se normalizan aparte con escalar_numericos() +
    tabular_scaler.json — ver docstring del módulo.
    """
    vector = [float(raw[campo]) for campo in _CAMPOS_BASE]
    vector += [float(raw[f"color_{c}"]) for c in COLORES]
    vector += [float(raw[f"tipo_{t.lower()}"]) for t in TIPOS_PRIMARIOS]
    vector += _onehot_fijo(str(raw["rarity"]), RARITY_VOCAB)
    vector += _onehot_fijo(str(raw["set_type"]), SET_TYPE_VOCAB)
    vector += _onehot_fijo(str(raw["frame"]), FRAME_VOCAB)
    vector += _onehot_fijo(str(raw["border_color"]), BORDER_COLOR_VOCAB)
    return vector


def escalar_numericos(vector: list[float], medias: list[float], desvios: list[float]) -> list[float]:
    """
    Devuelve una copia de `vector` con las posiciones NUMERIC_INDICES
    estandarizadas: (x - media) / desvío. `medias`/`desvios` vienen de
    tabular_scaler.json, en el mismo orden que NUMERIC_FIELDS/NUMERIC_INDICES.
    """
    vector = list(vector)
    for idx, media, desvio in zip(NUMERIC_INDICES, medias, desvios):
        vector[idx] = (vector[idx] - media) / desvio if desvio > 0 else 0.0
    return vector
