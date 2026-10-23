/**
 * Business rules for data-subject requests (ROADMAP.md O15,
 * ACTIVIDAD_5.md §2) — pure functions, unit-tested in rights-policy.spec.ts.
 */

export type RightsType = 'ACCESS' | 'RECTIFICATION' | 'ERASURE';

/** Ley 19.628 (texto Ley 21.719), art. 11: answer within 30 calendar days of receipt. */
export const RESPONSE_DEADLINE_DAYS = 30;

export function dueDateFor(receivedAt: Date): Date {
  return new Date(
    receivedAt.getTime() + RESPONSE_DEADLINE_DAYS * 24 * 60 * 60 * 1000,
  );
}

/**
 * Identity verification proportional to risk (ACTIVIDAD_5.md §2.1). The
 * session already proves who is asking; a step-up (password, + TOTP when
 * the account has 2FA) is added only where a stolen session would do
 * real damage — and nothing extra (ID card, phone…) is ever collected.
 *
 *   ACCESS        step-up   hands over *all* the account's data at once
 *   ERASURE       step-up   irreversible
 *   RECTIFICATION email     step-up   taking over the address = taking over the account
 *   RECTIFICATION name/lang session   low impact, the user can change it back
 */
export function requiresStepUp(
  type: RightsType,
  rectifiedFields: string[] = [],
): boolean {
  if (type !== 'RECTIFICATION') return true;
  return rectifiedFields.includes('email');
}

/** Codes stored on a DENIED request (details.reason) and shown to the player. */
export type DenialReason =
  | 'IDENTITY_NOT_VERIFIED'
  | 'STEP_UP_REUSED'
  | 'OPEN_TRANSACTIONS'
  | 'ACTIVE_AUCTION'
  | 'ADMIN_ROLE'
  | 'NOTHING_TO_RECTIFY'
  | 'EMAIL_IN_USE';

export interface ErasureFacts {
  pendingTransactions: number;
  activeAuctionsAsSeller: number;
  leadingBidsInActiveAuctions: number;
  role: 'USER' | 'SUPPORT' | 'ADMIN';
}

/**
 * When erasure can't go ahead right now (art. 7, "No procede la supresión
 * cuando el tratamiento sea necesario … para la ejecución de un contrato"):
 *   - a purchase or sale still PENDING: the other party is owed a card or
 *     a payment, and the record is needed to settle it;
 *   - a live auction the player is selling in or currently winning: erasing
 *     would void a binding bid mid-auction;
 *   - a staff account: its role must be removed by another ADMIN first, so
 *     an erasure request can't be used to make an admin's actions vanish
 *     from accountability (separation of duties).
 * Each denial is temporary and says why, so the player can retry once it's
 * resolved (art. 11: a denial must be grounded).
 */
export function erasureBlockers(facts: ErasureFacts): DenialReason[] {
  const reasons: DenialReason[] = [];
  if (facts.pendingTransactions > 0) reasons.push('OPEN_TRANSACTIONS');
  if (facts.activeAuctionsAsSeller + facts.leadingBidsInActiveAuctions > 0) {
    reasons.push('ACTIVE_AUCTION');
  }
  if (facts.role !== 'USER') reasons.push('ADMIN_ROLE');
  return reasons;
}

/**
 * What is erased and what is kept (ACTIVIDAD_5.md §2.4).
 *   - no transactions at all → the account row itself is deleted (cascade);
 *   - with closed transactions → those must be kept (6 years, Código
 *     Tributario arts. 17 y 200; art. 7 ii "cumplimiento de una obligación
 *     legal"), so the account becomes an anonymous tombstone: email, name
 *     and password overwritten, nothing left that identifies the person,
 *     and the transactions point at "Cuenta eliminada".
 */
export function erasureMode(totalTransactions: number): 'delete' | 'tombstone' {
  return totalTransactions === 0 ? 'delete' : 'tombstone';
}

export const DENIAL_MESSAGES: Record<DenialReason, string> = {
  IDENTITY_NOT_VERIFIED:
    'No pudimos verificar tu identidad: vuelve a ingresar tu contraseña (y tu código 2FA si lo tienes activo).',
  STEP_UP_REUSED:
    'La verificación ya se usó en otra solicitud. Verifica tu identidad de nuevo.',
  OPEN_TRANSACTIONS:
    'Tienes compras o ventas pendientes. Cuando se completen o cancelen podrás pedir la eliminación.',
  ACTIVE_AUCTION:
    'Participas en una subasta activa (vendiendo o con la oferta más alta). Espera a que termine.',
  ADMIN_ROLE:
    'Las cuentas con rol de personal deben ser degradadas por otro administrador antes de eliminarse.',
  NOTHING_TO_RECTIFY: 'Los datos enviados son iguales a los actuales.',
  EMAIL_IN_USE: 'Ese correo ya está asociado a otra cuenta.',
};
