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

export const LISTING_TOKEN_TTL = '15m';
