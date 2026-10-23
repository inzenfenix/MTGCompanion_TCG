/**
 * Data minimization for the Bazaar distance feature (ROADMAP.md O14,
 * docs/security/ACTIVIDAD_4.md §1). The app shows "how far is the seller"
 * in whole kilometres, so storing the exact GPS fix (≈1 m with 5+ decimals —
 * enough to point at someone's house) is more than the purpose needs.
 *
 * 2 decimal places ≈ 1.1 km of latitude (and ≤ 1.1 km of longitude in
 * Chile), which keeps the distance shown to the buyer accurate to about a
 * kilometre while making the stored value a neighbourhood, not an address.
 * Applied before encryption, so not even a decrypted value carries more.
 */
export const LOCATION_DECIMALS = 2;

export function coarsenCoordinate(value: number): number {
  const factor = 10 ** LOCATION_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** A stored location older than this is treated as absent (see LOCATION_TTL_DAYS in configuration.ts). */
export function isLocationFresh(
  updatedAt: Date | null | undefined,
  ttlDays: number,
  now: Date = new Date(),
): boolean {
  if (!updatedAt) return false;
  return now.getTime() - updatedAt.getTime() <= ttlDays * 24 * 60 * 60 * 1000;
}
