import {
  POSITION_WINDOW_MS,
  SearchPositionTracker,
} from './search-position-tracker';

// ROADMAP.md O17 — feeds bazaar.location.triangulation.
describe('SearchPositionTracker', () => {
  const t0 = 1_800_000_000_000;

  it('a searcher staying in the same ~1 km cell is "new" only once', () => {
    const t = new SearchPositionTracker();
    expect(t.observe('u', -33.4489, -70.6693, t0)).toBe(true);
    expect(t.observe('u', -33.4471, -70.6681, t0 + 1000)).toBe(false);
    expect(t.observe('u', -33.4489, -70.6693, t0 + 2000)).toBe(false);
  });

  it('jumping between cells counts every jump', () => {
    const t = new SearchPositionTracker();
    const points = [
      [-33.45, -70.66],
      [-33.5, -70.66],
      [-33.45, -70.6],
      [-33.4, -70.7],
      [-33.48, -70.62],
    ];
    const fresh = points.filter(([lat, lng], i) =>
      t.observe('u', lat, lng, t0 + i * 1000),
    ).length;
    expect(fresh).toBe(5);
  });

  it('forgets positions after the window, and keeps searchers apart', () => {
    const t = new SearchPositionTracker();
    t.observe('a', -33.45, -70.66, t0);
    expect(t.observe('b', -33.45, -70.66, t0)).toBe(true);
    expect(t.observe('a', -33.45, -70.66, t0 + POSITION_WINDOW_MS + 1)).toBe(
      true,
    );
  });
});
