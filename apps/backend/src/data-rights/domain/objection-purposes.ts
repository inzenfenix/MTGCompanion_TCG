/**
 * Processing a player can object to (ROADMAP.md O16, ACTIVIDAD_6.md §6) —
 * the single source of truth, like consent-purposes.ts is for consent.
 *
 * Ley 19.628 (texto Ley 21.719), art. 8 only gives a right of objection
 * against processing based on legitimate interest (a), direct marketing
 * (b) or public sources without another basis (c). So this catalog holds
 * exactly the legitimate-interest processing the app does:
 *
 *   - Processing based on **contract** (account, listings, purchases,
 *     receipts) isn't here: art. 8 doesn't apply to it, and the way out of
 *     a contract is erasure (art. 7), which already exists.
 *   - Processing based on **consent** (location, optional emails, 2FA) isn't
 *     here either: there the right is revocation, any time and with no
 *     reason (art. 12, POST/DELETE /consents/me/:purpose).
 *   - The app does no direct marketing and no profiling (b), and takes
 *     nothing from public sources about players (c).
 *
 * For each purpose the decision is fixed in advance and written down,
 * so it doesn't depend on who handles the request. Art. 8 a: the controller
 * must stop "salvo que acredite motivos legítimos imperiosos … que
 * prevalezcan … o para la formulación, el ejercicio o la defensa de
 * reclamaciones".
 */

export const OBJECTION_PURPOSE_CODES = [
  'SALES_STATISTICS',
  'SECURITY_MONITORING',
] as const;
export type ObjectionPurposeCode = (typeof OBJECTION_PURPOSE_CODES)[number];

export interface ObjectionPurposeDefinition {
  code: ObjectionPurposeCode;
  title: string;
  /** What is done with the player's data, in plain words. */
  description: string;
  legalBasis: string;
  /** UPHOLD = the objection is granted; DENY = compelling grounds prevail. */
  decision: 'UPHOLD' | 'DENY';
  /** UPHOLD: what stops. DENY: the grounds given to the player (art. 11). */
  effect: string;
}

export const OBJECTION_PURPOSES: Readonly<
  Record<ObjectionPurposeCode, ObjectionPurposeDefinition>
> = {
  SALES_STATISTICS: {
    code: 'SALES_STATISTICS',
    title: 'Estadísticas de ventas',
    description:
      'Tus compras y ventas pagadas se suman, sin tu nombre ni tu id, al informe mensual de ventas ' +
      '(mes, condición de la carta, medio de pago; se suprime toda celda con menos de 5 compradores o 5 vendedores) ' +
      'que el equipo usa para entender cómo se mueve el mercado.',
    legalBasis: 'Interés legítimo (Ley 19.628, art. 13 d)',
    decision: 'UPHOLD',
    effect:
      'Tus transacciones dejan de entrar en el cálculo del informe desde la consulta siguiente. ' +
      'El informe no es necesario para darte el servicio, así que no hay motivo que prevalezca.',
  },
  SECURITY_MONITORING: {
    code: 'SECURITY_MONITORING',
    title: 'Monitoreo de seguridad',
    description:
      'Las acciones sensibles de tu cuenta (inicios de sesión, cambios de datos, solicitudes) quedan ' +
      'en un registro de auditoría seudonimizado y encadenado, y se revisan para detectar ' +
      'accesos no autorizados y fraude.',
    legalBasis: 'Interés legítimo (Ley 19.628, art. 13 d)',
    decision: 'DENY',
    effect:
      'No podemos dejar de hacerlo: hay motivos legítimos imperiosos que prevalecen (proteger tu cuenta ' +
      'y la de los demás jugadores frente a accesos no autorizados y fraude) y el registro es la prueba ' +
      'para la defensa ante reclamaciones (Ley 19.628, art. 8 a). Para limitar el impacto, el registro ' +
      'no guarda tu correo, tu IP ni valores de tus datos, solo un seudónimo, y se borra al cumplir su ' +
      'plazo de conservación.',
  },
};

export function isObjectionPurpose(code: string): code is ObjectionPurposeCode {
  return (OBJECTION_PURPOSE_CODES as readonly string[]).includes(code);
}
