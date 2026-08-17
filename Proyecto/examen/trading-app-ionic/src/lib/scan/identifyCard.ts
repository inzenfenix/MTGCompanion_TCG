/**
 * ROADMAP.md E3b — "identify which catalog card this photo is", the piece
 * that was missing despite E1/E2/E3/E4 all existing individually. Chosen
 * approach (see ROADMAP.md's note on this decision): OCR the card's name +
 * catalog search + Stage 2 rerank, **not** a full visual-embedding nearest-
 * neighbor index over the 58,679-card catalog. That would need a whole
 * separate server-side pipeline (download every catalog card's image,
 * batch-embed it, store/serve the vectors) for a backbone G4d already
 * measured at only ~18-25% real-photo Top-1 accuracy — not worth it next to
 * this much cheaper path, which reuses entirely-already-built pieces:
 *
 *   1. `ocrExtractor.ts::extractCardName()` — OCR the title bar.
 *   2. `GET /catalog/search?q=<name>` (F6, already exists) — a handful of
 *      name-matching candidates, ranked by `edhrecRank` server-side.
 *   3. `ocrExtractor.ts::extractCardText()` — OCR the rules-text box.
 *   4. `GET /catalog/search-by-text?q=<rules text>` (ROADMAP.md I19/I25,
 *      new) — a second, independent set of candidates found by fuzzy-
 *      matching the OCR'd rules text against `oracleText` instead of the
 *      name. Added after a real live session found the rules-text OCR can
 *      read cleanly even when the title-bar crop is pure noise (the card
 *      localizer's warp is imperfect on angled/hand-held captures, and that
 *      hits the tiny title box far harder than the much bigger rules-text
 *      box) — relying on the title alone was throwing away a perfectly good
 *      signal. Both searches run in parallel and their results are merged
 *      (deduped by card id) — whichever OCR pass actually worked
 *      contributes candidates, neither is required on its own.
 *   5. `stage2TextValidator.ts::runStage2Validation()` (real trained model,
 *      E1) against each candidate's own `name + oracleText` — this is what
 *      actually disambiguates among same-name reprints/near-matches, using
 *      real oracle text, not just a fuzzy name/text string.
 *
 * Candidates come back sorted by Stage 2 confidence, highest first — the
 * caller (`ListCard.tsx`) auto-picks the top one but keeps the rest
 * available for a manual "not this one" override, per G4d's own suggested
 * "confirm from a few candidates" UX rather than blindly trusting a single
 * guess.
 */
import { extractCardName, extractCardText } from '../ml/ocrExtractor';
import { runStage2Validation } from '../ml/stage2TextValidator';
import type { ScryfallCardFields } from '../ml/priceFeatures';
import * as api from '../api';

const DEFAULT_SEARCH_LIMIT = 8;
/** OCR on a title bar this short is almost certainly noise, not a name — not worth a catalog search. */
const MIN_NAME_LENGTH = 2;
/** Matches catalog.service.ts's own MIN_TEXT_QUERY_LENGTH — no point sending a request the backend will just 400. */
const MIN_TEXT_LENGTH = 10;

export type IdentifyCandidate = {
  card: api.CatalogEntry;
  /** Stage 2's confidence (0..1) that `card`'s real oracle text matches the OCR'd rules text. */
  confidence: number;
  isMatch: boolean;
};

export type IdentifyResult = {
  ocrName: string;
  ocrRulesText: string;
  /** Sorted descending by `confidence`. */
  candidates: IdentifyCandidate[];
};

export type IdentifyStatus =
  // ocrName kept even though it's too short to search on — ROADMAP.md I19,
  // so a diagnostics UI can show what OCR actually read (garbage vs. empty)
  // instead of just "no match", when narrowing down why identification failed.
  | { status: 'no-name'; ocrName: string; ocrRulesText: string }
  | { status: 'no-candidates'; ocrName: string; ocrRulesText: string } // catalog search found nothing for that name
  | { status: 'error'; message: string }
  | { status: 'ok'; result: IdentifyResult };

/** Mirrors `texto_referencia()` in `certamen_2/text_validator_baseline.py` — same format the model was trained on. */
function referenceText(card: api.CatalogEntry): string {
  return `${card.name} ${card.oracleText ?? ''}`;
}

/** Merges the name-search and text-search candidate lists, keeping first-seen order and dropping repeats by card id. */
function dedupeById(cards: api.CatalogEntry[]): api.CatalogEntry[] {
  const seen = new Set<string>();
  const result: api.CatalogEntry[] = [];
  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    result.push(card);
  }
  return result;
}

/**
 * Maps the backend's camelCase `CatalogEntry` onto the raw-Scryfall-shaped
 * `ScryfallCardFields` `priceFeatures.ts`/Stage 3 expects (snake_case, same
 * field names as `certamen_1/data/cards.json`). One-to-one field rename,
 * no derivation — the backend's `CatalogCard` columns were added (E3b) to
 * carry exactly these Scryfall fields through unchanged.
 */
export function toScryfallFields(card: api.CatalogEntry): ScryfallCardFields {
  return {
    cmc: card.cmc,
    rarity: card.rarity,
    set_type: card.setType,
    frame: card.frame,
    border_color: card.borderColor,
    colors: card.colors,
    color_identity: card.colorIdentity,
    type_line: card.typeLine,
    finishes: card.finishes,
    frame_effects: card.frameEffects,
    released_at: card.releasedAt,
    edhrec_rank: card.edhrecRank,
  };
}

export async function identifyCard(
  canvas: HTMLCanvasElement,
  searchLimit: number = DEFAULT_SEARCH_LIMIT,
): Promise<IdentifyStatus> {
  try {
    const [ocrName, ocrRulesText] = await Promise.all([
      extractCardName(canvas),
      extractCardText(canvas),
    ]);
    // ROADMAP.md I19 — these are the breadcrumbs a live `adb logcat` session
    // needs to tell "OCR misread the name" apart from "catalog search missed
    // the right card" apart from "Stage 2 misranked a decent OCR read", none
    // of which were distinguishable from the outside before this.
    console.debug('[identifyCard] OCR name=%o rulesTextChars=%d', ocrName, ocrRulesText.length);

    const nameQuery = ocrName.trim();
    const textQuery = ocrRulesText.trim();

    // ROADMAP.md I19/I25 — run both candidate sources in parallel; either
    // one being unusable doesn't block the other. Only bail out to
    // 'no-name' when NEITHER OCR read has enough to search on at all.
    const searches: Promise<api.CatalogEntry[]>[] = [];
    if (nameQuery.length >= MIN_NAME_LENGTH) searches.push(api.searchCatalog(nameQuery, searchLimit));
    if (textQuery.length >= MIN_TEXT_LENGTH) searches.push(api.searchCatalogByText(textQuery, searchLimit));

    if (searches.length === 0) {
      console.debug('[identifyCard] neither OCR read is usable, not searching the catalog');
      return { status: 'no-name', ocrName, ocrRulesText };
    }

    const results = await Promise.all(searches);
    const catalogCandidates = dedupeById(results.flat());
    console.debug(
      '[identifyCard] catalog search name=%o text=%o -> %d candidate(s) (merged, deduped)',
      nameQuery, textQuery.length, catalogCandidates.length,
    );
    if (catalogCandidates.length === 0) {
      return { status: 'no-candidates', ocrName, ocrRulesText };
    }

    const scored = await Promise.all(
      catalogCandidates.map(async (card): Promise<IdentifyCandidate> => {
        const stage2 = await runStage2Validation(ocrRulesText, referenceText(card));
        // A model that's unavailable/errored still gives us the name-search
        // candidate — confidence 0 just means "not confirmed by text",
        // isMatch false, not a hard failure of the whole identify step.
        const confidence = stage2.status === 'ok' ? stage2.result.confidence : 0;
        const isMatch = stage2.status === 'ok' && stage2.result.isMatch;
        return { card, confidence, isMatch };
      }),
    );
    scored.sort((a, b) => b.confidence - a.confidence);
    console.debug(
      '[identifyCard] ranked: %o',
      scored.map((c) => `${c.card.name}=${c.confidence.toFixed(2)}${c.isMatch ? '(match)' : ''}`),
    );

    return { status: 'ok', result: { ocrName, ocrRulesText, candidates: scored } };
  } catch (err) {
    console.error('[identifyCard] failed:', err);
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
