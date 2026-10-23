import * as api from './api';

// ROADMAP.md O15 — the server is the only source of truth for location
// consent (it used to be a localStorage opt-out flag, O14). TabSearch asks
// here before saving a position: without a current LOCATION_DISTANCE
// consent nothing is sent at all (the backend would refuse it with 403
// anyway). The searcher's own position is still used for that one search's
// distances — sent as a query parameter, never stored server-side.
export async function hasLocationConsent(): Promise<boolean> {
  try {
    const consents = await api.getMyConsents();
    return consents.some((c) => c.purpose === 'LOCATION_DISTANCE' && c.effective);
  } catch {
    return false; // fail closed
  }
}
