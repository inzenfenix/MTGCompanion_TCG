/**
 * Client-side port of the Stage 3 tabular feature builder — mirrors
 * `pytorch/src/price_features.py` (byte-identical to `tensorFlow/src/price_features.py`,
 * see that module's docstring) field-for-field: same fixed vocabularies/order,
 * same "other" bucket, same 50-dim layout (48 + `edhrec_rank_conocido`/
 * `edhrec_rank_log`, added by ROADMAP.md B6 to close the price-estimator's
 * information ceiling — a card's rarity/set_type/frame alone can't tell a
 * $0.10 common from a $40 "chase" rare with the same categorical values;
 * `edhrec_rank` is Scryfall's demand/popularity signal). Deliberately
 * pure/deterministic, no `.fit()` — same reasoning as `hashingVectorizer.ts`
 * for Stage 2.
 *
 * Input is a **raw Scryfall-shaped card record** (the shape of an entry in
 * `ml/training/data/cards.json`, post `merge_edhrec_rank.py`), not the
 * backend's thin `Card` type from `src/lib/api.ts` (which only keeps
 * `title/oracleText/rarity/setName` for an *owned* card, not
 * `type_line`/`colors`/`frame`/`finishes`/`edhrec_rank`/etc.). This matches
 * the actual pipeline shape: Stage 3 runs at scan time against the Scryfall
 * metadata of whatever card Stage 1 retrieval matched, before anything is
 * saved as an owned `Card` — there's no catalog endpoint to fetch this from
 * yet (blocked on F6, see ROADMAP.md workstream F).
 */

const ANIO_ACTUAL = new Date().getFullYear();

const COLORES = ['W', 'U', 'B', 'R', 'G'] as const;
const TIPOS_PRIMARIOS = [
  'Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment',
  'Land', 'Planeswalker', 'Battle', 'Kindred', 'Tribal',
] as const;

// Vocabularios fijos + "other" — mismo orden que price_features.py, NUNCA
// reordenar (movería la posición de las columnas one-hot).
const RARITY_VOCAB = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'] as const;
const SET_TYPE_VOCAB = ['expansion', 'masters', 'commander', 'draft_innovation', 'core'] as const;
const FRAME_VOCAB = ['2015', '2003', '1997', '1993', 'future'] as const;
const BORDER_COLOR_VOCAB = ['black', 'borderless', 'white', 'yellow'] as const;

export const N_TAB_FEATURES = 50;

/** Raw Scryfall card fields this module actually reads — subset of a full `cards.json` entry. */
export type ScryfallCardFields = {
  cmc?: number | null;
  rarity?: string | null;
  set_type?: string | null;
  frame?: string | number | null;
  border_color?: string | null;
  colors?: string[] | null;
  color_identity?: string[] | null;
  type_line?: string | null;
  finishes?: string[] | null;
  frame_effects?: string[] | null;
  released_at?: string | null;
  /** Lower = more popular. Not every card has one (added by `merge_edhrec_rank.py`, ~98.8% coverage). */
  edhrec_rank?: number | null;
};

function onehotFijo(valor: string, vocab: readonly string[]): number[] {
  const v = new Array(vocab.length + 1).fill(0);
  const idx = vocab.indexOf(valor);
  v[idx >= 0 ? idx : vocab.length] = 1;
  return v;
}

/** Builds the 50-dim tabular vector (unscaled — see `escalarNumericos`) for one card. */
export function buildTabularVector(card: ScryfallCardFields): number[] {
  const typeLine = card.type_line ?? '';
  const colors = card.colors ?? [];
  const colorIdentity = card.color_identity ?? [];
  const finishes = card.finishes ?? [];
  const frameEffects = card.frame_effects ?? [];
  const releasedAt = card.released_at ?? '';
  const anioStr = releasedAt.slice(0, 4);
  const anio = /^\d{4}$/.test(anioStr) ? parseInt(anioStr, 10) : null;
  const anioResolved = anio ?? 2000;
  const antiguedad = anio !== null ? ANIO_ACTUAL - anio : 25;

  // Placeholder 0.0 + a "known" flag when missing, not imputed with a mean —
  // mirrors raw_card_fields()'s reasoning exactly.
  const edhrecRank = card.edhrec_rank ?? null;
  const edhrecRankConocido = edhrecRank !== null ? 1 : 0;
  const edhrecRankLog = edhrecRank !== null ? Math.log1p(edhrecRank) : 0;

  const base = [
    card.cmc ?? 0,
    colorIdentity.length,
    colors.length === 0 ? 1 : 0,
    typeLine.includes('Legendary') ? 1 : 0,
    frameEffects.length,
    finishes.includes('foil') ? 1 : 0,
    finishes.includes('etched') ? 1 : 0,
    anioResolved,
    antiguedad,
    edhrecRankConocido,
    edhrecRankLog,
  ];

  const colorFlags = COLORES.map((c) => (colors.includes(c) ? 1 : 0));
  const tipoFlags = TIPOS_PRIMARIOS.map((t) => (typeLine.includes(t) ? 1 : 0));

  return [
    ...base,
    ...colorFlags,
    ...tipoFlags,
    ...onehotFijo(String(card.rarity ?? 'unknown'), RARITY_VOCAB),
    ...onehotFijo(String(card.set_type ?? 'unknown'), SET_TYPE_VOCAB),
    ...onehotFijo(String(card.frame ?? 'unknown'), FRAME_VOCAB),
    ...onehotFijo(String(card.border_color ?? 'unknown'), BORDER_COLOR_VOCAB),
  ];
}

/** Indices into the 11-field base block that get standardized — mirrors NUMERIC_INDICES. */
const NUMERIC_INDICES = [0, 1, 4, 7, 8, 10]; // cmc, n_colores, n_frame_effects, anio, antiguedad_anios, edhrec_rank_log

export type TabularScaler = { fields: string[]; mean: number[]; std: number[] };

/** (x - mean) / std at NUMERIC_INDICES, matching `escalar_numericos()`. */
export function escalarNumericos(vector: number[], scaler: TabularScaler): number[] {
  const out = vector.slice();
  NUMERIC_INDICES.forEach((idx, i) => {
    const std = scaler.std[i];
    out[idx] = std > 0 ? (vector[idx] - scaler.mean[i]) / std : 0;
  });
  return out;
}
