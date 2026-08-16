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
  });
  afterEach(() => vi.restoreAllMocks());

  it('returns no-name when the title-bar OCR is too short to be a real name', async () => {
    vi.mocked(extractCardName).mockResolvedValue(' ');
    vi.mocked(extractCardText).mockResolvedValue('some rules text');

    const result = await identifyCard(fakeCanvas);
    expect(result.status).toBe('no-name');
    expect(api.searchCatalog).not.toHaveBeenCalled();
  });

  it('returns no-candidates when the catalog search finds nothing', async () => {
    vi.mocked(extractCardName).mockResolvedValue('Not A Real Card Name');
    vi.mocked(extractCardText).mockResolvedValue('rules text');
    vi.mocked(api.searchCatalog).mockResolvedValue([]);

    const result = await identifyCard(fakeCanvas);
    expect(result.status).toBe('no-candidates');
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
    vi.mocked(extractCardText).mockResolvedValue('rules text');
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
