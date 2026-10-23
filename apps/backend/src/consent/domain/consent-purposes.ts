import { createHash } from 'node:crypto';

/**
 * Purposes that rely on consent (ROADMAP.md O15, ACTIVIDAD_5.md §1.1) — the
 * single source of truth for which ones exist, the exact text the player is
 * shown and its version. Everything the service needs to run (account,
 * listings, purchases, receipts) is processed under the contract basis
 * (Ley 19.628, art. 13 c) and is deliberately NOT here: asking consent for
 * something the service can't work without would make it presumptively
 * not free (art. 12).
 *
 * Changing a text materially = bump `version`. Consents given to an older
 * version stop counting (ConsentService.hasConsent) until the player
 * accepts the new text, so nobody is assumed to agree to wording they
 * never saw.
 */

export const CONSENT_PURPOSE_CODES = [
  'LOCATION_DISTANCE',
  'EMAIL_NOTIFICATIONS',
  'TWO_FACTOR',
] as const;
export type ConsentPurposeCode = (typeof CONSENT_PURPOSE_CODES)[number];

export interface ConsentPurposeDefinition {
  code: ConsentPurposeCode;
  version: string;
  title: string;
  text: string;
  dataCategories: string[];
  retention: string;
  /** What the system does the moment this consent is revoked. */
  onRevoke: string;
  /**
   * false = granted/revoked through its own flow, not POST/DELETE
   * /consents/me/:purpose. TWO_FACTOR is enabled by proving a TOTP code and
   * disabled with one (/auth/2fa/*): letting a bare session toggle it would
   * let a stolen session turn 2FA off.
   */
  selfService: boolean;
  managedBy?: string;
}

export const CONSENT_PURPOSES: Readonly<
  Record<ConsentPurposeCode, ConsentPurposeDefinition>
> = {
  LOCATION_DISTANCE: {
    code: 'LOCATION_DISTANCE',
    version: '1',
    title: 'Distancia a los vendedores',
    text:
      'Usaremos tu ubicación aproximada (redondeada a ~1 km y guardada cifrada) ' +
      'solo para mostrar a qué distancia están los vendedores en el Bazar y, si vendes, ' +
      'a qué distancia estás tú de quien busca. Nunca mostramos tus coordenadas a otros ' +
      'jugadores ni las compartimos con terceros. Se borran a los 30 días sin actualizarse ' +
      'o en cuanto retires este consentimiento. La búsqueda funciona igual sin ella.',
    dataCategories: [
      'geolocalización aproximada (categoría especial, art. 16 sexies)',
    ],
    retention: '30 días desde la última actualización, o hasta la revocación',
    onRevoke:
      'Se borran las coordenadas guardadas y PATCH /users/me/location queda bloqueado (403) hasta un nuevo consentimiento.',
    selfService: true,
  },
  EMAIL_NOTIFICATIONS: {
    code: 'EMAIL_NOTIFICATIONS',
    version: '1',
    title: 'Correos opcionales',
    text:
      'Te enviaremos un correo cuando alguien haga una oferta por una de tus cartas. ' +
      'Los correos necesarios para tu cuenta (bienvenida, comprobantes de pago y avisos ' +
      'de seguridad) no dependen de esta opción.',
    dataCategories: ['correo electrónico'],
    retention: 'Mientras exista la cuenta y el consentimiento esté vigente',
    onRevoke:
      'Se deja de enviar el correo de nuevas ofertas desde el evento siguiente; los correos ya enviados no se pueden retirar.',
    selfService: true,
  },
  TWO_FACTOR: {
    code: 'TWO_FACTOR',
    version: '1',
    title: 'Verificación en dos pasos (2FA)',
    text:
      'Guardaremos cifrado un secreto TOTP para pedirte un código de tu app autenticadora ' +
      'al iniciar sesión. Se borra al desactivar la verificación en dos pasos.',
    dataCategories: ['secreto TOTP (cifrado AES-256-GCM)'],
    retention: 'Hasta que desactives 2FA',
    onRevoke:
      'Se borra el secreto TOTP y el inicio de sesión deja de pedir el código.',
    selfService: false,
    managedBy: '/auth/2fa/enable y /auth/2fa/disable (exigen un código válido)',
  },
};

export function isConsentPurpose(code: string): code is ConsentPurposeCode {
  return (CONSENT_PURPOSE_CODES as readonly string[]).includes(code);
}

/** SHA-256 of exactly what the player was shown — stored in each ConsentEvent as proof. */
export function purposeTextHash(def: ConsentPurposeDefinition): string {
  return createHash('sha256')
    .update(`${def.code}\n${def.version}\n${def.title}\n${def.text}`)
    .digest('hex');
}
