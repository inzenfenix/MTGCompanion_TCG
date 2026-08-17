/**
 * ROADMAP.md E3b — unit tests for identifyCard.ts's orchestration/ranking
 * logic. The three collaborators (OCR, catalog search, Stage 2) are each
 * already unit-/real-model-tested on their own (ocrExtractor.test.ts,
 * stage2TextValidator.test.ts, and E1/E6's real end-to-end verifications) —
 * these tests mock all three and check that this module wires them
 * together and ranks correctly, not that OCR/ONNX/HTTP themselves work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ml/ocrExtractor', () => ({
  extractCardName: vi.fn(),
  extractCardText: vi.fn(),
}));
vi.mock('../ml/stage2TextValidator', () => ({
  runStage2Validation: vi.fn(),
}));
vi.mock('../api', () => ({
  searchCatalog: vi.fn(),
  searchCatalogByText: vi.fn(),
}));

import { extractCardName, extractCardText } from '../ml/ocrExtractor';
import { runStage2Validation } from '../ml/stage2TextValidator';
import * as api from '../api';
import { identifyCard, toScryfallFields } from './identifyCard';

const fakeCanvas = {} as HTMLCanvasElement;

function fakeCatalogEntry(overrides: Partial<api.CatalogEntry> = {}): api.CatalogEntry {
  return {
    id: 'id-1',
    name: 'Lightning Bolt',
    setCode: 'lea',
    setName: 'Limited Edition Alpha',
    rarity: 'common',
    typeLine: 'Instant',
    manaCost: '{R}',
    cmc: 1,
    colors: ['R'],
    oracleText: 'Lightning Bolt deals 3 damage to any target.',
    imageUrl: null,
    edhrecRank: 160,
    setType: 'core',
    frame: '1993',
    borderColor: 'black',
    colorIdentity: ['R'],
    finishes: ['nonfoil'],
    frameEffects: [],
    releasedAt: '1993-08-05',
    ...overrides,
  };
}

describe('identifyCard', () => {
  beforeEach(() => {
    vi.mocked(extractCardName).mockReset();
    vi.mocked(extractCardText).mockReset();
    vi.mocked(runStage2Validation).mockReset();
    vi.mocked(api.searchCatalog).mockReset();
    vi.mocked(api.searchCatalogByText).mockReset().mockResolvedValue([]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns no-name when NEITHER OCR read is usable (name too short, rules text too short for search-by-text)', async () => {
    vi.mocked(extractCardName).mockResolvedValue(' ');
    vi.mocked(extractCardText).mockResolvedValue('short'); // < MIN_TEXT_LENGTH (10)

    const result = await identifyCard(fakeCanvas);
    // ROADMAP.md I19 — ocrName/ocrRulesText must survive onto this status so
    // a diagnostics UI can show what OCR actually read, not just "no match".
    expect(result).toEqual({ status: 'no-name', ocrName: ' ', ocrRulesText: 'short' });
    expect(api.searchCatalog).not.toHaveBeenCalled();
    expect(api.searchCatalogByText).not.toHaveBeenCalled();
  });

  it('returns no-candidates when both catalog searches find nothing', async () => {
    vi.mocked(extractCardName).mockResolvedValue('Not A Real Card Name');
    vi.mocked(extractCardText).mockResolvedValue('rules text long enough to search');
    vi.mocked(api.searchCatalog).mockResolvedValue([]);
    vi.mocked(api.searchCatalogByText).mockResolvedValue([]);

    const result = await identifyCard(fakeCanvas);
    expect(result).toEqual({
      status: 'no-candidates',
      ocrName: 'Not A Real Card Name',
      ocrRulesText: 'rules text long enough to search',
    });
  });

  // ROADMAP.md I19/I25 — the actual real-session scenario: name OCR is
  // noise (too short to even search), but the rules-text OCR read well
  // enough to find the real card via search-by-text alone.
  it('falls back to search-by-text alone when the name is unusable but the rules text is', async () => {
    const card = fakeCatalogEntry({ id: 'found-by-text' });
    vi.mocked(extractCardName).mockResolvedValue(' '); // too short to search at all
    vi.mocked(extractCardText).mockResolvedValue('Whenever a creature an opponent controls dies, create a Blood token.');
    vi.mocked(api.searchCatalogByText).mockResolvedValue([card]);
    vi.mocked(runStage2Validation).mockResolvedValue({ status: 'ok', result: { isMatch: true, confidence: 0.9 } });

    const result = await identifyCard(fakeCanvas);
    if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`);
    expect(api.searchCatalog).not.toHaveBeenCalled(); // name too short — only search-by-text should have run
    expect(result.result.candidates.map((c) => c.card.id)).toEqual(['found-by-text']);
  });

  it('merges name-search and text-search candidates, deduping by card id', async () => {
    const fromNameOnly = fakeCatalogEntry({ id: 'name-only', name: 'Name Only' });
    const fromBoth = fakeCatalogEntry({ id: 'both', name: 'Found Both Ways' });
    const fromTextOnly = fakeCatalogEntry({ id: 'text-only', name: 'Text Only' });
    vi.mocked(extractCardName).mockResolvedValue('Found Both Ways');
    vi.mocked(extractCardText).mockResolvedValue('rules text long enough to search');
    vi.mocked(api.searchCatalog).mockResolvedValue([fromNameOnly, fromBoth]);
    vi.mocked(api.searchCatalogByText).mockResolvedValue([fromBoth, fromTextOnly]); // 'both' repeated across sources
    vi.mocked(runStage2Validation).mockResolvedValue({ status: 'ok', result: { isMatch: false, confidence: 0.1 } });

    const result = await identifyCard(fakeCanvas);
    if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`);
    const ids = result.result.candidates.map((c) => c.card.id).sort();
    expect(ids).toEqual(['both', 'name-only', 'text-only']); // 3 unique, not 4
  });

  it('ranks candidates by Stage 2 confidence, highest first, regardless of catalog search order', async () => {
    const weak = fakeCatalogEntry({ id: 'weak', name: 'Weak Match' });
    const strong = fakeCatalogEntry({ id: 'strong', name: 'Strong Match' });
    vi.mocked(extractCardName).mockResolvedValue('Lightning Bolt');
    vi.mocked(extractCardText).mockResolvedValue('deals 3 damage to any target');
    vi.mocked(api.searchCatalog).mockResolvedValue([weak, strong]);
    vi.mocked(runStage2Validation).mockImplementation(async (_ocr, refText) => {
      if (refText.startsWith('Strong Match')) {
        return { status: 'ok', result: { isMatch: true, confidence: 0.95 } };
      }
      return { status: 'ok', result: { isMatch: false, confidence: 0.1 } };
    });

    const result = await identifyCard(fakeCanvas);
    if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`);
    expect(result.result.candidates.map((c) => c.card.id)).toEqual(['strong', 'weak']);
    expect(result.result.candidates[0].confidence).toBeCloseTo(0.95);
    expect(result.result.candidates[0].isMatch).toBe(true);
  });

  it('treats an unavailable/errored Stage 2 model as zero confidence, not a hard failure', async () => {
    vi.mocked(extractCardName).mockResolvedValue('Lightning Bolt');
    vi.mocked(extractCardText).mockResolvedValue('rules text long enough to search');
    vi.mocked(api.searchCatalog).mockResolvedValue([fakeCatalogEntry()]);
    vi.mocked(runStage2Validation).mockResolvedValue({ status: 'unavailable' });

    const result = await identifyCard(fakeCanvas);
    if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`);
    expect(result.result.candidates[0].confidence).toBe(0);
    expect(result.result.candidates[0].isMatch).toBe(false);
  });

  it('returns an error status if a collaborator throws', async () => {
    vi.mocked(extractCardName).mockRejectedValue(new Error('canvas is not attached to the DOM'));
    vi.mocked(extractCardText).mockResolvedValue('');

    const result = await identifyCard(fakeCanvas);
    expect(result.status).toBe('error');
  });
});

describe('toScryfallFields', () => {
  it('maps the camelCase CatalogEntry onto snake_case ScryfallCardFields 1:1', () => {
    const card = fakeCatalogEntry();
    const fields = toScryfallFields(card);
    expect(fields).toEqual({
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
    });
  });
});
