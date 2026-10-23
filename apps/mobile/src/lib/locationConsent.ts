// ROADMAP.md O14 — remembers on this device that the player withdrew
// location sharing (Security settings), so TabSearch stops re-sending it on
// every Bazaar visit. The backend already erased the stored value
// (DELETE /users/me/location); this only stops the client from re-sharing.
// The searcher's own position is still used for that one search's
// distances — sent as a query parameter, never stored server-side.
const KEY = 'mtg.location.optOut';

export function isLocationSharingOptedOut(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setLocationSharingOptedOut(optedOut: boolean): void {
  try {
    if (optedOut) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode / storage blocked — the server-side revoke still happened */
  }
}
