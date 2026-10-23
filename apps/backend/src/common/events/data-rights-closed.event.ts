export const DATA_RIGHTS_CLOSED_EVENT = 'data-rights.closed';

/**
 * ROADMAP.md O15 — a rights request was answered. Ley 19.628 (texto Ley
 * 21.719), art. 11 asks for a written answer to the player's address, and a
 * denial to say why and that a claim can be filed with the Agencia within 30
 * business days. The email is captured *before* executing, because after an
 * erasure there is no account left to read it from.
 */
export class DataRightsClosedEvent {
  constructor(
    public readonly email: string,
    public readonly displayName: string,
    public readonly requestId: string,
    public readonly type: 'ACCESS' | 'RECTIFICATION' | 'ERASURE',
    public readonly outcome: 'FULFILLED' | 'DENIED',
    public readonly message: string | null,
  ) {}
}
