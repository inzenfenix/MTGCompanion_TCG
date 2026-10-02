/**
 * ROADMAP.md G3 — unit tests for priceFeatures.ts. Fixtures cross-checked
 * against the real `pytorch/src/price_features.py` (byte-identical to the
 * TensorFlow copy) this session — same method E2 used to verify this port
 * against real cards.
 */

import { describe, expect, it } from 'vitest';
import { N_TAB_FEATURES, buildTabularVector, escalarNumericos, type ScryfallCardFields } from './priceFeatures';

const SOL_RING: ScryfallCardFields = {
  cmc: 1, colors: [], color_identity: [], type_line: 'Artifact',
  finishes: ['nonfoil', 'foil'], frame_effects: [], released_at: '1993-08-05',
  rarity: 'uncommon', set_type: 'core', frame: '1993', border_color: 'black',
  edhrec_rank: 5,
};

const LEGENDARY_NO_RANK: ScryfallCardFields = {
  cmc: 4, colors: ['R', 'G'], color_identity: ['R', 'G'], type_line: 'Legendary Creature — Human Warrior',
  finishes: ['nonfoil'], frame_effects: ['legendary'], released_at: '2022-11-18',
  rarity: 'mythic', set_type: 'expansion', frame: '2015', border_color: 'black',
  edhrec_rank: null,
};

const UNSEEN_VOCAB_VALUES: ScryfallCardFields = {
  cmc: 2.5, colors: ['U'], color_identity: ['U'], type_line: 'Instant',
  finishes: ['etched'], frame_effects: [], released_at: '2030-01-01',
  rarity: 'special-future', set_type: 'future-set-type', frame: '9999', border_color: 'chrome',
  edhrec_rank: 12345,
};

// Real Python output for the three cards above, from
// raw_card_fields()+build_tabular_vector() in pytorch/src/price_features.py
// (same module byte-identical in tensorFlow/src/), regenerated this session.
const EXPECTED_SOL_RING = [
  1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1993.0, 33.0, 1.0, 1.791759469228055,
  0.0, 0.0, 0.0, 0.0, 0.0, // colors W U B R G
  0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // tipos (Artifact = index 3)
  0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, // rarity: uncommon
  0.0, 0.0, 0.0, 0.0, 1.0, 0.0, // set_type: core
  0.0, 0.0, 0.0, 1.0, 0.0, 0.0, // frame: 1993
  1.0, 0.0, 0.0, 0.0, 0.0, // border_color: black
];

const EXPECTED_LEGENDARY = [
  4.0, 2.0, 0.0, 1.0, 1.0, 0.0, 0.0, 2022.0, 4.0, 0.0, 0.0,
  0.0, 0.0, 0.0, 1.0, 1.0, // colors: R=1, G=1
  1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // tipos: Creature=1
  0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, // rarity: mythic
  1.0, 0.0, 0.0, 0.0, 0.0, 0.0, // set_type: expansion
  1.0, 0.0, 0.0, 0.0, 0.0, 0.0, // frame: 2015
  1.0, 0.0, 0.0, 0.0, 0.0, // border_color: black
];

const EXPECTED_UNSEEN = [
  2.5, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 2030.0, -4.0, 1.0, 9.421087402953841,
  0.0, 1.0, 0.0, 0.0, 0.0, // colors: U=1
  0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // tipos: Instant=1
  0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, // rarity: other
  0.0, 0.0, 0.0, 0.0, 0.0, 1.0, // set_type: other
  0.0, 0.0, 0.0, 0.0, 0.0, 1.0, // frame: other
  0.0, 0.0, 0.0, 0.0, 1.0, // border_color: other
];

function expectClose(actual: number[], expected: number[]) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9));
}

describe('buildTabularVector — matches real Python price_features.py output', () => {
  it('produces N_TAB_FEATURES (50) dims', () => {
    expect(buildTabularVector(SOL_RING).length).toBe(N_TAB_FEATURES);
    expect(N_TAB_FEATURES).toBe(50);
  });

  it('matches Python exactly for a common colorless artifact with a known edhrec_rank', () => {
    expectClose(buildTabularVector(SOL_RING), EXPECTED_SOL_RING);
  });

  it('matches Python exactly for a legendary multicolor card with no edhrec_rank', () => {
    expectClose(buildTabularVector(LEGENDARY_NO_RANK), EXPECTED_LEGENDARY);
  });

  it('matches Python exactly when rarity/set_type/frame/border_color are all unseen ("other" bucket)', () => {
    expectClose(buildTabularVector(UNSEEN_VOCAB_VALUES), EXPECTED_UNSEEN);
  });

  it('edhrec_rank_conocido/edhrec_rank_log use a 0.0 placeholder + flag, not an imputed mean, when unknown', () => {
    const vector = buildTabularVector(LEGENDARY_NO_RANK);
    expect(vector[9]).toBe(0); // edhrec_rank_conocido
    expect(vector[10]).toBe(0); // edhrec_rank_log
  });

  it('missing optional fields default sanely instead of throwing', () => {
    expect(() => buildTabularVector({})).not.toThrow();
    const vector = buildTabularVector({});
    expect(vector.length).toBe(N_TAB_FEATURES);
  });
});

describe('escalarNumericos', () => {
  const scaler = { fields: ['cmc', 'n_colores', 'n_frame_effects', 'anio', 'antiguedad_anios', 'edhrec_rank_log'],
    mean: [2.0, 1.5, 0.2, 2015.0, 10.0, 3.0], std: [1.0, 1.0, 0.5, 5.0, 5.0, 2.0] };

  it('matches Python escalar_numericos exactly', () => {
    const raw = buildTabularVector(SOL_RING);
    const scaled = escalarNumericos(raw, scaler);

    const EXPECTED_SCALED_NUMERIC = [-1.0, -1.5, 1.0, 0.0, -0.4, 1.0, 0.0, -4.4, 4.6, 1.0, -0.6041202653859725];
    for (let i = 0; i < 11; i++) expect(scaled[i]).toBeCloseTo(EXPECTED_SCALED_NUMERIC[i], 9);
    // Non-numeric dims (one-hot blocks) must pass through untouched.
    for (let i = 11; i < N_TAB_FEATURES; i++) expect(scaled[i]).toBe(raw[i]);
  });

  it('does not mutate the input vector', () => {
    const raw = buildTabularVector(SOL_RING);
    const copy = raw.slice();
    escalarNumericos(raw, scaler);
    expect(raw).toEqual(copy);
  });

  it('handles a zero-std field without producing NaN/Infinity', () => {
    const degenerateScaler = { ...scaler, std: scaler.std.map(() => 0) };
    const raw = buildTabularVector(SOL_RING);
    const scaled = escalarNumericos(raw, degenerateScaler);
    for (let i = 0; i < 11; i++) expect(Number.isFinite(scaled[i])).toBe(true);
  });
});
