// Signed with the same secret/mechanism as a real access token, but
// deliberately shaped differently (`typ`) — same pattern
// TwoFactorPendingPayload already established (auth.service.ts) —
// JwtStrategy rejects any payload with `typ === 'listing'` so a scanned QR
// token can never double as a bearer token on a protected route.
//
// ROADMAP.md J4 — "sign it now, not deferred": the QR a seller generates
// (Tab2.tsx) encodes this token instead of a bare `TRADE:<cardId>`, so a
// forged/tampered QR can't point the Buy page (J5) at an arbitrary card id
// under a fabricated listing context.
export interface ListingTokenPayload {
  cardId: string;
  typ: 'listing';
}

// ROADMAP.md J15 — lowered from 15m to 3m, user's own ask: a stale QR left
// on a table shouldn't stay scannable that long. Independent of J12's
// AUCTION_WINDOW_MS (5s, resets per new offer) — that governs how long an
// already-JOINED auction stays open for counter-bids; this only governs how
// long the QR itself is valid to be scanned/entered at all.
export const LISTING_TOKEN_TTL = '3m';
