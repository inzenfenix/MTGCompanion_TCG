/**
 * ROADMAP.md G3 — unit tests for hashingVectorizer.ts. These fixtures are
 * REAL `sklearn.feature_extraction.text.HashingVectorizer(analyzer="char_wb",
 * ngram_range=(3,5), n_features=512, alternate_sign=False, norm="l2")`
 * output (regenerated from the actual Python module this session, same
 * method E1 used to verify bit-identical output — see ROADMAP.md
 * workstream E, E1's own row), not hand-computed — a bug in either the
 * fixture or the port would show up as a mismatch either way, so these are
 * as trustworthy as re-running E1's original verification.
 */

import { describe, expect, it } from 'vitest';
import { HASHING_N_FEATURES, hashingVectorize } from './hashingVectorizer';

/** Sparse (index, value) pairs from real sklearn output -> a dense 512-dim array for comparison. */
function sparseToDense(pairs: [number, number][]): Float32Array {
  const dense = new Float32Array(HASHING_N_FEATURES);
  for (const [i, v] of pairs) dense[i] = v;
  return dense;
}

const FIXTURES: Record<string, [number, number][]> = {
  a: [[440, 1.0]],
  '': [],
  'Sol  Ring': [
    [5, 0.2581988897471611], [105, 0.2581988897471611], [107, 0.2581988897471611],
    [147, 0.2581988897471611], [152, 0.2581988897471611], [175, 0.2581988897471611],
    [207, 0.2581988897471611], [220, 0.2581988897471611], [222, 0.2581988897471611],
    [275, 0.2581988897471611], [323, 0.2581988897471611], [381, 0.2581988897471611],
    [389, 0.2581988897471611], [411, 0.2581988897471611], [429, 0.2581988897471611],
  ],
  'Fireball!': [
    [19, 0.20412414523193154], [21, 0.20412414523193154], [67, 0.20412414523193154],
    [116, 0.20412414523193154], [128, 0.20412414523193154], [139, 0.20412414523193154],
    [164, 0.20412414523193154], [176, 0.20412414523193154], [192, 0.20412414523193154],
    [232, 0.20412414523193154], [233, 0.20412414523193154], [255, 0.20412414523193154],
    [278, 0.20412414523193154], [305, 0.20412414523193154], [312, 0.20412414523193154],
    [319, 0.20412414523193154], [327, 0.20412414523193154], [339, 0.20412414523193154],
    [340, 0.20412414523193154], [372, 0.20412414523193154], [388, 0.20412414523193154],
    [427, 0.20412414523193154], [452, 0.20412414523193154], [478, 0.20412414523193154],
  ],
  'café münster': [
    [12, 0.18569533817705186], [21, 0.18569533817705186], [34, 0.18569533817705186],
    [45, 0.18569533817705186], [59, 0.18569533817705186], [75, 0.18569533817705186],
    [88, 0.18569533817705186], [96, 0.18569533817705186], [150, 0.18569533817705186],
    [201, 0.18569533817705186], [241, 0.18569533817705186], [264, 0.18569533817705186],
    [266, 0.18569533817705186], [275, 0.18569533817705186], [290, 0.18569533817705186],
    [298, 0.18569533817705186], [309, 0.3713906763541037], [340, 0.18569533817705186],
    [350, 0.18569533817705186], [357, 0.18569533817705186], [374, 0.18569533817705186],
    [402, 0.18569533817705186], [408, 0.18569533817705186], [420, 0.18569533817705186],
    [457, 0.18569533817705186], [477, 0.18569533817705186],
  ],
  'Æther Vial': [
    [18, 0.20851441405707477], [26, 0.20851441405707477], [50, 0.20851441405707477],
    [54, 0.20851441405707477], [87, 0.20851441405707477], [123, 0.20851441405707477],
    [146, 0.20851441405707477], [158, 0.20851441405707477], [228, 0.20851441405707477],
    [245, 0.41702882811414954], [275, 0.20851441405707477], [339, 0.20851441405707477],
    [353, 0.20851441405707477], [370, 0.20851441405707477], [380, 0.20851441405707477],
    [384, 0.20851441405707477], [391, 0.20851441405707477], [419, 0.20851441405707477],
    [422, 0.20851441405707477], [494, 0.20851441405707477],
  ],
};

describe('hashingVectorize — bit-identical to sklearn HashingVectorizer', () => {
  for (const [text, pairs] of Object.entries(FIXTURES)) {
    it(`matches real sklearn output for ${JSON.stringify(text)}`, () => {
      const expected = sparseToDense(pairs);
      const actual = hashingVectorize(text);

      expect(actual.length).toBe(HASHING_N_FEATURES);
      for (let i = 0; i < HASHING_N_FEATURES; i++) {
        expect(actual[i]).toBeCloseTo(expected[i], 6);
      }
    });
  }

  it('empty string produces an all-zero vector (nothing to normalize)', () => {
    const vec = hashingVectorize('');
    expect(Array.from(vec).every((v) => v === 0)).toBe(true);
  });

  it('output is L2-normalized (unit norm) for any non-empty input', () => {
    const vec = hashingVectorize('Lightning Bolt');
    let normSq = 0;
    for (const v of vec) normSq += v * v;
    expect(Math.sqrt(normSq)).toBeCloseTo(1.0, 5);
  });

  it('is case-insensitive, matching sklearn\'s default lowercase=True', () => {
    const lower = hashingVectorize('lightning bolt');
    const upper = hashingVectorize('LIGHTNING BOLT');
    expect(Array.from(upper)).toEqual(Array.from(lower));
  });

  it('is deterministic across repeated calls (no hidden state)', () => {
    const a = hashingVectorize('Sol Ring');
    const b = hashingVectorize('Sol Ring');
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
