/**
 * Business rules for data-subject requests (ROADMAP.md O15,
 * ACTIVIDAD_5.md §2; O16, ACTIVIDAD_6.md) — pure functions, unit-tested in
 * rights-policy.spec.ts.
 */

export type RightsType =
  'ACCESS' | 'RECTIFICATION' | 'ERASURE' | 'OBJECTION' | 'BLOCKING';
export type RightsChannel = 'APP' | 'EMAIL_FORM';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ley 19.628 (texto Ley 21.719), art. 11: answer within 30 calendar days of receipt. */
export const RESPONSE_DEADLINE_DAYS = 30;
/** Art. 11, blocking: "dentro de los dos días hábiles siguientes a su recepción". */
export const BLOCKING_DEADLINE_BUSINESS_DAYS = 2;

/**
 * Business days = Monday to Friday. Chilean public holidays are not
 * modelled, so the computed date can only be *earlier* than the legal one,
 * never later — the safe side for a deadline we have to meet.
 */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d.setTime(d.getTime() + DAY_MS);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

export function dueDateFor(
  receivedAt: Date,
  type: RightsType = 'ACCESS',
): Date {
  if (type === 'BLOCKING') {
    return addBusinessDays(receivedAt, BLOCKING_DEADLINE_BUSINESS_DAYS);
  }
  return new Date(receivedAt.getTime() + RESPONSE_DEADLINE_DAYS * DAY_MS);
}

// ── Public contact form (O16, ACTIVIDAD_6.md §1) ─────────────────────────

/** Types the public form takes. BLOCKING goes along with one of them (`requestBlocking`). */
export const PUBLIC_FORM_TYPES = [
  'ACCESS',
  'RECTIFICATION',
  'ERASURE',
  'OBJECTION',
] as const;
/** The emailed confirmation code is valid this long. */
export const CONFIRMATION_TTL_MS = DAY_MS;
/** After confirming, the holder has this long to finish in the app (step-up). */
export const COMPLETION_TTL_MS = 14 * DAY_MS;
/** Per address and rolling 24 h: more are dropped silently (no row, no email). */
export const PUBLIC_REQUESTS_PER_DAY = 3;

/**
 * Whether proving control of the account's mailbox (the emailed single-use
 * code) is enough to execute the request, or it must also be completed in
 * the app with a step-up. Only objection passes: it restricts processing,
 * the holder can withdraw it, and it hands nothing out. Access hands over
 * every piece of data, erasure can't be undone and a rectification changes
 * the data — those keep the same bar as in the app (requiresStepUp).
 */
export function mailboxProofSuffices(type: RightsType): boolean {
  return type === 'OBJECTION';
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
  // O16: objection and blocking only *restrict* processing, hand nothing
  // out and can be withdrawn by the holder — the session is enough.
  if (type === 'OBJECTION' || type === 'BLOCKING') return false;
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
  | 'EMAIL_IN_USE'
  // O16
  | 'COMPELLING_GROUNDS'
  | 'NO_PENDING_REQUEST'
  | 'NO_ACCOUNT'
  | 'CONFIRMATION_EXPIRED';

// ── Blocking (O16, ACTIVIDAD_6.md §6) ─────────────────────────────────────

/**
 * Art. 8 ter: blocking can be asked (1) while a rectification, erasure or
 * objection is pending, or (2) "alternativamente al de supresión" — instead
 * of erasing. What it covers is fixed (NON_ESSENTIAL_PROCESSING): see
 * ProcessingControlService and ACTIVIDAD_6.md §6.2.
 */
export type BlockingBasis = 'PENDING_REQUEST' | 'ALTERNATIVE_TO_ERASURE';
export const BLOCKING_SCOPE = 'NON_ESSENTIAL_PROCESSING';
const BLOCKABLE_TYPES: RightsType[] = ['RECTIFICATION', 'ERASURE', 'OBJECTION'];
const OPEN_STATUSES = [
  'AWAITING_CONFIRMATION',
  'PENDING_STEP_UP',
  'RECEIVED',
  'VERIFIED',
  'IN_EVALUATION',
];

/**
 * PENDING_REQUEST needs the related request to be the holder's own (the
 * caller looks it up scoped by owner, so someone else's is simply null),
 * still open, and of a type art. 8 ter names. Unverified requests
 * (AWAITING_CONFIRMATION) don't count: nobody has shown they're the holder.
 */
export function blockingDenial(
  basis: BlockingBasis,
  related: { type: RightsType; status: string } | null,
): DenialReason | null {
  if (basis === 'ALTERNATIVE_TO_ERASURE') return null;
  if (
    !related ||
    !BLOCKABLE_TYPES.includes(related.type) ||
    !OPEN_STATUSES.includes(related.status) ||
    related.status === 'AWAITING_CONFIRMATION'
  ) {
    return 'NO_PENDING_REQUEST';
  }
  return null;
}

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
    'Tienes compras o ventas pendientes. Cuando se completen o cancelen podrás pedir la eliminación. Mientras tanto puedes pedir el bloqueo temporal de tus datos como alternativa.',
  ACTIVE_AUCTION:
    'Participas en una subasta activa (vendiendo o con la oferta más alta). Espera a que termine. Mientras tanto puedes pedir el bloqueo temporal de tus datos como alternativa.',
  ADMIN_ROLE:
    'Las cuentas con rol de personal deben ser degradadas por otro administrador antes de eliminarse.',
  NOTHING_TO_RECTIFY: 'Los datos enviados son iguales a los actuales.',
  EMAIL_IN_USE: 'Ese correo ya está asociado a otra cuenta.',
  COMPELLING_GROUNDS:
    'Existen motivos legítimos imperiosos que prevalecen para continuar con este tratamiento (Ley 19.628, art. 8 a).',
  NO_PENDING_REQUEST:
    'El bloqueo por solicitud pendiente requiere una solicitud tuya de rectificación, supresión u oposición que siga abierta y verificada.',
  NO_ACCOUNT:
    'No encontramos una cuenta asociada a este correo, así que no tratamos datos personales vinculados a él.',
  CONFIRMATION_EXPIRED:
    'La solicitud no se confirmó o no se completó a tiempo, así que no pudimos verificar tu identidad. Puedes enviarla de nuevo.',
};
