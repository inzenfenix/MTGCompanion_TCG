/**
 * Client-side port of `sklearn.feature_extraction.text.HashingVectorizer`,
 * configured exactly like `build_vectorizer()` in
 * `ml/training/{pytorch,tensorFlow}/src/text_matcher.py` (Stage 2):
 * `analyzer="char_wb", ngram_range=(3, 5), n_features=512,
 * alternate_sign=False, norm="l2"`. Needed because Stage 2's ONNX graph
 * takes the already-vectorized 2048-dim feature tensor as input, not raw
 * text — see `stage2TextValidator.ts`.
 *
 * Must be bit-identical to sklearn's output (same MurmurHash3 seed/behavior,
 * same char n-gram tokenization, same L2 norm) — a different hash function
 * or a slightly-off tokenizer would silently produce a valid-looking but
 * meaningless feature vector, not a visible error. Verified against real
 * `HashingVectorizer(...).transform(...)` output for a range of inputs
 * (short words, multi-word phrases, accented characters, punctuation,
 * multi-space runs, the empty string) — see ROADMAP.md workstream E, E1.
 *
 * Ported from sklearn's actual source (not from memory/docs), specifically:
 *   - `HashingVectorizer._char_wb_ngrams` (feature_extraction/text.py) —
 *     including the easy-to-miss `if offset == 0: break` that stops trying
 *     larger n once a word is shorter than n, instead of re-emitting the
 *     same padded-word ngram once per n.
 *   - `FeatureHasher.transform` → `_hashing_fast.pyx` (Cython) — each
 *     char-ngram feature has an implicit value of 1, hashed via
 *     `murmurhash3_bytes_s32(utf8_bytes, seed=0)` (signed 32-bit
 *     MurmurHash3_x86_32 over the UTF-8 encoding), column
 *     `index = abs(h) % n_features` (with the documented `INT_MIN` special
 *     case), value accumulates (not overwritten) on repeated ngrams/hash
 *     collisions since `alternate_sign=False` here (no sign flip).
 */

const N_FEATURES = 512;
const MIN_N = 3;
const MAX_N = 5;

/** MurmurHash3_x86_32 (Austin Appleby's canonical algorithm), seed as given. Returns a signed 32-bit int. */
function murmur3x86_32(bytes: Uint8Array, seed: number): number {
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let h1 = seed >>> 0;
  const len = bytes.length;
  const nblocks = Math.floor(len / 4);

  for (let i = 0; i < nblocks; i++) {
    let k1 =
      (bytes[i * 4] & 0xff) |
      ((bytes[i * 4 + 1] & 0xff) << 8) |
      ((bytes[i * 4 + 2] & 0xff) << 16) |
      ((bytes[i * 4 + 3] & 0xff) << 24);

    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
  }

  const tailIndex = nblocks * 4;
  let k1 = 0;
  const rem = len & 3;
  if (rem === 3) k1 ^= (bytes[tailIndex + 2] & 0xff) << 16;
  if (rem >= 2) k1 ^= (bytes[tailIndex + 1] & 0xff) << 8;
  if (rem >= 1) {
    k1 ^= bytes[tailIndex] & 0xff;
    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);
    h1 ^= k1;
  }

  h1 ^= len;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  return h1 | 0; // reinterpret as signed 32-bit, matching murmurhash3_bytes_s32
}

const utf8Encoder = new TextEncoder();

/**
 * Whitespace-sensitive char-n-gram tokenization inside word boundaries,
 * n-grams at word edges padded with a single space — mirrors
 * `HashingVectorizer._char_wb_ngrams` exactly, including its early-break
 * once a word is shorter than the current n (so a 1-char word contributes
 * one ngram, not one per n in [MIN_N, MAX_N]).
 */
function charWbNgrams(text: string): string[] {
  const normalized = text.replace(/\s\s+/g, ' ');
  const ngrams: string[] = [];
  for (const word of normalized.split(/\s+/)) {
    if (word.length === 0) continue;
    const w = ` ${word} `;
    const wLen = w.length;
    for (let n = MIN_N; n <= MAX_N; n++) {
      let offset = 0;
      ngrams.push(w.slice(offset, offset + n));
      while (offset + n < wLen) {
        offset += 1;
        ngrams.push(w.slice(offset, offset + n));
      }
      if (offset === 0) break;
    }
  }
  return ngrams;
}

/** Vectorizes one document into a 512-dim, L2-normalized hashed n-gram feature vector. */
export function hashingVectorize(text: string): Float32Array {
  const lowered = (text || '').toLowerCase();
  const ngrams = charWbNgrams(lowered);
  const vec = new Float64Array(N_FEATURES);

  for (const gram of ngrams) {
    const bytes = utf8Encoder.encode(gram);
    const h = murmur3x86_32(bytes, 0);
    let index: number;
    if (h === -2147483648) {
      // abs(-2**31) overflows a signed 32-bit int — sklearn's Cython code
      // special-cases this to what `abs(-2**31) % n_features` would mean.
      index = (2147483647 - (N_FEATURES - 1)) % N_FEATURES;
    } else {
      index = Math.abs(h) % N_FEATURES;
    }
    vec[index] += 1;
  }

  let normSq = 0;
  for (let i = 0; i < N_FEATURES; i++) normSq += vec[i] * vec[i];
  const norm = Math.sqrt(normSq);
  const out = new Float32Array(N_FEATURES);
  if (norm > 0) {
    for (let i = 0; i < N_FEATURES; i++) out[i] = vec[i] / norm;
  }
  return out;
}

export { N_FEATURES as HASHING_N_FEATURES };
