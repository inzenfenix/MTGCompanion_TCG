import { Injectable } from '@nestjs/common';

/** ~1 km cells (2 decimals), the same precision stored locations use (O14). */
const cell = (lat: number, lng: number) =>
  `${lat.toFixed(2)},${lng.toFixed(2)}`;
export const POSITION_WINDOW_MS = 10 * 60 * 1000;

/**
 * Feeds the `bazaar.location.triangulation` alert (ROADMAP.md O17,
 * ACTIVIDAD_7.md §4). Each Bazaar search with a position reveals the
 * distance from that point to every seller who shares their location;
 * three or more searches from *different* points let someone triangulate
 * a seller. A person searching from their phone stays in one or two
 * ~1 km cells over ten minutes — jumping across many is the signal.
 *
 * Kept in process memory only, per searcher, for 10 minutes: the searcher's
 * position never reaches the database or the audit log — only the fact
 * that it was a new cell ("new-position"). Lost on restart, which only
 * delays detection by one window.
 */
@Injectable()
export class SearchPositionTracker {
  private readonly seen = new Map<string, { cell: string; at: number }[]>();

  /** true when this searcher hasn't searched from this cell in the window. */
  observe(searcherId: string, lat: number, lng: number, now = Date.now()) {
    const c = cell(lat, lng);
    const recent = (this.seen.get(searcherId) ?? []).filter(
      (e) => now - e.at < POSITION_WINDOW_MS,
    );
    const isNew = !recent.some((e) => e.cell === c);
    recent.push({ cell: c, at: now });
    this.seen.set(searcherId, recent.slice(-50));
    if (this.seen.size > 10_000) this.prune(now);
    return isNew;
  }

  private prune(now: number) {
    for (const [k, v] of this.seen) {
      if (!v.some((e) => now - e.at < POSITION_WINDOW_MS)) this.seen.delete(k);
    }
  }
}
