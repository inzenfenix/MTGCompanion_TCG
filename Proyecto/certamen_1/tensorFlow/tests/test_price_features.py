"""
ROADMAP.md G1 — unit tests for src/price_features.py (Stage 3 tabular
vectorizer, TensorFlow side). Pure Python, no tensorflow/sklearn needed to
exercise this module (see its own docstring — deliberately
dependency-free). Byte-identical to pytorch/tests/test_price_features.py
since the module itself is byte-identical in both frameworks (CLAUDE.md
rule 4-style duplication, see B1/B6 in ROADMAP.md).
"""

import math

import pytest

from src.price_features import (
    BORDER_COLOR_VOCAB, FRAME_VOCAB, N_TAB_FEATURES, NUMERIC_INDICES, RARITY_VOCAB, SET_TYPE_VOCAB,
    build_tabular_vector, escalar_numericos, raw_card_fields,
)


def _carta_base(**overrides) -> dict:
    carta = {
        "cmc": 3,
        "colors": ["R"],
        "color_identity": ["R"],
        "type_line": "Instant",
        "finishes": ["nonfoil"],
        "frame_effects": [],
        "released_at": "2010-06-15",
        "rarity": "common",
        "set_type": "expansion",
        "frame": "2015",
        "border_color": "black",
        "edhrec_rank": None,
    }
    carta.update(overrides)
    return carta


def test_build_tabular_vector_has_n_tab_features_dims():
    raw = raw_card_fields(_carta_base())
    vector = build_tabular_vector(raw)

    assert len(vector) == N_TAB_FEATURES == 50
    assert all(isinstance(v, float) for v in vector)


def test_unseen_rarity_falls_back_to_other_bucket():
    raw = raw_card_fields(_carta_base(rarity="future-fake-rarity"))
    vector = build_tabular_vector(raw)

    # rarity one-hot block starts right after the 11 base fields + 5 colors + 10 types.
    start = 11 + 5 + 10
    rarity_block = vector[start : start + len(RARITY_VOCAB) + 1]

    assert rarity_block == [0.0] * len(RARITY_VOCAB) + [1.0]  # "other" bucket is the last slot


def test_known_rarity_sets_the_right_onehot_slot():
    raw = raw_card_fields(_carta_base(rarity="mythic"))
    vector = build_tabular_vector(raw)

    start = 11 + 5 + 10
    rarity_block = vector[start : start + len(RARITY_VOCAB) + 1]
    expected = [0.0] * (len(RARITY_VOCAB) + 1)
    expected[RARITY_VOCAB.index("mythic")] = 1.0

    assert rarity_block == expected


def test_set_type_frame_border_color_also_have_other_fallback():
    raw = raw_card_fields(_carta_base(set_type="unknown-future-type", frame="9999", border_color="chrome"))
    vector = build_tabular_vector(raw)

    start = 11 + 5 + 10 + len(RARITY_VOCAB) + 1
    set_type_block = vector[start : start + len(SET_TYPE_VOCAB) + 1]
    start += len(SET_TYPE_VOCAB) + 1
    frame_block = vector[start : start + len(FRAME_VOCAB) + 1]
    start += len(FRAME_VOCAB) + 1
    border_block = vector[start : start + len(BORDER_COLOR_VOCAB) + 1]

    assert set_type_block[-1] == 1.0
    assert frame_block[-1] == 1.0
    assert border_block[-1] == 1.0


def test_edhrec_rank_known_sets_flag_and_log_value():
    raw = raw_card_fields(_carta_base(edhrec_rank=99))
    assert raw["edhrec_rank_conocido"] == 1
    assert raw["edhrec_rank_log"] == pytest.approx(math.log1p(99))


def test_edhrec_rank_unknown_uses_placeholder_zero_not_a_guessed_mean():
    raw = raw_card_fields(_carta_base(edhrec_rank=None))
    assert raw["edhrec_rank_conocido"] == 0
    assert raw["edhrec_rank_log"] == 0.0


def test_colorless_card_flagged_and_no_color_onehot_set():
    raw = raw_card_fields(_carta_base(colors=[], color_identity=[]))
    assert raw["es_incoloro"] == 1
    vector = build_tabular_vector(raw)
    color_block = vector[11 : 11 + 5]
    assert color_block == [0.0] * 5


def test_legendary_type_line_detected():
    raw = raw_card_fields(_carta_base(type_line="Legendary Creature — Human Wizard"))
    assert raw["es_legendaria"] == 1


def test_escalar_numericos_standardizes_only_numeric_indices():
    raw = raw_card_fields(_carta_base())
    vector = build_tabular_vector(raw)

    medias = [0.0] * len(NUMERIC_INDICES)
    desvios = [1.0] * len(NUMERIC_INDICES)
    scaled = escalar_numericos(vector, medias, desvios)

    # With mean=0/std=1 the numeric slots are unchanged, but it must return
    # a NEW list (not mutate the input) — same defensive pattern the module
    # docstring calls out for build_tabular_vector's callers.
    assert scaled == vector
    assert scaled is not vector


def test_escalar_numericos_handles_zero_desvio_without_dividing_by_zero():
    vector = [5.0] * N_TAB_FEATURES
    medias = [0.0] * len(NUMERIC_INDICES)
    desvios = [0.0] * len(NUMERIC_INDICES)  # degenerate case: a numeric field with zero variance

    scaled = escalar_numericos(vector, medias, desvios)

    for idx in NUMERIC_INDICES:
        assert scaled[idx] == 0.0
