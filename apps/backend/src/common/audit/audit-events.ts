/**
 * Catalog of audited events (ROADMAP.md O17, ACTIVIDAD_7.md §1) — the single
 * source of truth for *what* the system audits. Every `action` written to
 * `audit_logs` must be here: audit-events.spec.ts scans the source for
 * action literals and fails on an uncatalogued one, and the e2e suite checks
 * every row it produced.
 *
 * Every row has the same fields whatever the event (schema.prisma
 * `AuditLog`, ACTIVIDAD_7.md §1.2): id, seq, createdAt, actorPseudonym,
 * actorRole, action, targetPseudonym, resourceType, resourceRef, reason,
 * outcome, prevHash, hash. What changes per event is only what goes into
 * resourceType/resourceRef/reason — described here — and never a value of
 * the personal data itself.
 *
 * `personalData` names the inventory categories (Hito 1) the operation
 * reads or changes; the incident timeline uses it to say which categories
 * an incident touched (art. 14 sexies: "las categorías de datos").
 */

export type AuditCategory =
  | 'AUTH'
  | 'ACCOUNT'
  | 'CONSENT'
  | 'RIGHTS'
  | 'ACCESS'
  | 'MARKET'
  | 'STAFF'
  | 'SECURITY'
  | 'SYSTEM';

/** READ = someone saw personal data; WRITE = it changed; CONTROL = a security/admin control acted. */
export type AuditKind = 'READ' | 'WRITE' | 'AUTH' | 'CONTROL';

/** Inventory categories (Hito 1, §4). */
export type DataCategory =
  | 'identificación'
  | 'credenciales'
  | 'geolocalización'
  | 'transacciones'
  | 'colección'
  | 'preferencias'
  | 'registro de auditoría';

export interface AuditEventDef {
  category: AuditCategory;
  kind: AuditKind;
  description: string;
  personalData: DataCategory[];
  /** What resourceType/resourceRef/reason carry for this event. */
  fields: string;
}

const ev = (
  category: AuditCategory,
  kind: AuditKind,
  personalData: DataCategory[],
  description: string,
  fields: string,
): AuditEventDef => ({ category, kind, personalData, description, fields });

export const AUDIT_EVENTS: Readonly<Record<string, AuditEventDef>> = {
  // ── Authentication ──────────────────────────────────────────────────────
  'auth.login': ev(
    'AUTH',
    'AUTH',
    ['credenciales'],
    'Inicio de sesión (correcto, fallido o bloqueado)',
    'reason: bad-password | unknown-email | locked | disabled; actor "anonymous" si el correo no existe',
  ),
  'auth.2fa': ev(
    'AUTH',
    'AUTH',
    ['credenciales'],
    'Segundo factor al iniciar sesión',
    'outcome FAILED con código inválido',
  ),
  'auth.step-up': ev(
    'AUTH',
    'AUTH',
    ['credenciales'],
    'Reautenticación para una operación sensible',
    'reason: método (password, password+totp) o motivo del fallo',
  ),
  'auth.2fa.enable': ev(
    'AUTH',
    'WRITE',
    ['credenciales'],
    'Activación de la verificación en dos pasos',
    '—',
  ),
  'auth.2fa.disable': ev(
    'AUTH',
    'WRITE',
    ['credenciales'],
    'Desactivación de la verificación en dos pasos',
    '—',
  ),

  // ── Account ─────────────────────────────────────────────────────────────
  'account.register': ev(
    'ACCOUNT',
    'WRITE',
    ['identificación', 'credenciales'],
    'Creación de una cuenta',
    'actor = la cuenta creada',
  ),
  'account.location.update': ev(
    'ACCOUNT',
    'WRITE',
    ['geolocalización'],
    'El titular guarda su ubicación aproximada',
    'sin coordenadas; outcome DENIED si falta consentimiento o hay bloqueo',
  ),
  'account.location.erase': ev(
    'ACCOUNT',
    'WRITE',
    ['geolocalización'],
    'El titular borra su ubicación',
    '—',
  ),

  // ── Consent ─────────────────────────────────────────────────────────────
  'consent.grant': ev(
    'CONSENT',
    'WRITE',
    ['preferencias'],
    'Otorgamiento de un consentimiento',
    'resourceRef: finalidad; reason: versión y origen',
  ),
  'consent.revoke': ev(
    'CONSENT',
    'WRITE',
    ['preferencias'],
    'Revocación de un consentimiento',
    'resourceRef: finalidad',
  ),

  // ── Data-subject rights ─────────────────────────────────────────────────
  'data.export': ev(
    'RIGHTS',
    'READ',
    [
      'identificación',
      'geolocalización',
      'transacciones',
      'colección',
      'preferencias',
    ],
    'Acceso y portabilidad: exportación completa',
    'resourceRef: id de la solicitud; reason: código de denegación',
  ),
  'data.rectify': ev(
    'RIGHTS',
    'WRITE',
    ['identificación', 'preferencias'],
    'Rectificación',
    'reason: nombres de los campos (nunca los valores)',
  ),
  'data.erase': ev(
    'RIGHTS',
    'WRITE',
    [
      'identificación',
      'credenciales',
      'geolocalización',
      'transacciones',
      'colección',
      'preferencias',
    ],
    'Supresión',
    'reason: delete | tombstone | código de denegación',
  ),
  'data.object': ev(
    'RIGHTS',
    'WRITE',
    ['transacciones'],
    'Oposición a un tratamiento',
    'reason: finalidad o código de denegación',
  ),
  'data.block': ev(
    'RIGHTS',
    'WRITE',
    [],
    'Bloqueo temporal del tratamiento',
    'reason: base del bloqueo o código de denegación',
  ),
  'data.objection.withdraw': ev(
    'RIGHTS',
    'WRITE',
    [],
    'El titular retira una oposición',
    'resourceRef: id del control',
  ),
  'data.blocking.lift': ev(
    'RIGHTS',
    'WRITE',
    [],
    'Se levanta un bloqueo',
    'reason: BLOCKING:<alcance>:<motivo>',
  ),
  'data.public-request': ev(
    'RIGHTS',
    'WRITE',
    [],
    'Solicitud por el formulario público (sin sesión)',
    'reason: received:<tipo> | throttled',
  ),
  'data.public-request.confirm': ev(
    'RIGHTS',
    'AUTH',
    [],
    'Confirmación de una solicitud del formulario con el código del correo',
    'reason: email-link',
  ),

  // ── Access to personal data (O17) ──────────────────────────────────────
  'access.transaction.read': ev(
    'ACCESS',
    'READ',
    ['transacciones', 'identificación'],
    'Una parte ve el detalle de una transacción (incluye el alias de la contraparte)',
    'resourceRef: id de la transacción; target: la contraparte; DENIED si no es parte o no existe',
  ),
  'access.transaction.list': ev(
    'ACCESS',
    'READ',
    ['transacciones', 'identificación'],
    'El titular lista sus compras y ventas',
    'reason: n=<cantidad>',
  ),
  'access.receipt.read': ev(
    'ACCESS',
    'READ',
    ['transacciones', 'identificación'],
    'Una parte descarga el comprobante',
    'resourceRef: id de la transacción; target: la contraparte; DENIED si no es parte',
  ),
  'access.profile.read': ev(
    'ACCESS',
    'READ',
    ['identificación'],
    'Alguien ve el perfil público (alias) de otra cuenta',
    'target: la cuenta vista',
  ),
  'access.location.distance': ev(
    'ACCESS',
    'READ',
    ['geolocalización'],
    'Búsqueda en el Bazar que calcula distancias a vendedores con su ubicación',
    'reason: sellers=<n>; new-position cuando el buscador "salta" a otra celda de ~1 km (nunca coordenadas)',
  ),

  // ── Marketplace operations on personal data (O17) ──────────────────────
  'market.card.create': ev(
    'MARKET',
    'WRITE',
    ['colección'],
    'Publicación o registro de una carta',
    'resourceRef: id de la carta',
  ),
  'market.card.delete': ev(
    'MARKET',
    'WRITE',
    ['colección'],
    'Eliminación de una carta',
    'resourceRef: id de la carta',
  ),
  'market.offer.place': ev(
    'MARKET',
    'WRITE',
    ['transacciones'],
    'Oferta por una carta de otra cuenta',
    'resourceRef: id de la carta; outcome DENIED si la oferta no procede (409 con bloqueo, 400 bajo el mínimo)',
  ),
  'market.transaction.create': ev(
    'MARKET',
    'WRITE',
    ['transacciones'],
    'Inicio de una compra',
    'resourceRef: id de la transacción; target: el vendedor',
  ),
  'market.cash.confirm': ev(
    'MARKET',
    'WRITE',
    ['transacciones'],
    'El vendedor confirma un pago en efectivo',
    'resourceRef: id de la transacción; target: el comprador',
  ),

  // ── Staff (SUPPORT/ADMIN) ───────────────────────────────────────────────
  'admin.users.list': ev(
    'STAFF',
    'READ',
    ['identificación'],
    'Listado de cuentas (correos enmascarados)',
    'reason: n=<cantidad>',
  ),
  'support.transactions.read': ev(
    'STAFF',
    'READ',
    ['transacciones'],
    'Soporte consulta las transacciones de una cuenta',
    'target: la cuenta; reason: motivo obligatorio',
  ),
  'admin.role.change': ev(
    'STAFF',
    'CONTROL',
    [],
    'Cambio de rol',
    'target: la cuenta; reason: rol nuevo',
  ),
  'admin.audit.read': ev(
    'STAFF',
    'READ',
    ['registro de auditoría'],
    'Lectura del registro de auditoría',
    '—',
  ),
  'admin.audit.verify': ev(
    'STAFF',
    'CONTROL',
    ['registro de auditoría'],
    'Verificación de la cadena de integridad',
    'reason: ok | broken at seq N',
  ),
  'admin.reports.sales.read': ev(
    'STAFF',
    'READ',
    [],
    'Informe de ventas anonimizado (k = 5)',
    '—',
  ),
  'admin.pseudonym.resolve': ev(
    'STAFF',
    'READ',
    ['identificación'],
    'Re-identificación de un seudónimo',
    'reason: motivo obligatorio',
  ),
  'admin.data-rights.list': ev(
    'STAFF',
    'READ',
    [],
    'Seguimiento de plazos de solicitudes (seudonimizado)',
    '—',
  ),
  'admin.incident.timeline': ev(
    'STAFF',
    'READ',
    ['registro de auditoría'],
    'Reconstrucción de un incidente desde el registro',
    'resourceRef: id de la alerta; reason: filas y estado de la cadena',
  ),

  // ── Security ────────────────────────────────────────────────────────────
  'security.alert.raised': ev(
    'SECURITY',
    'CONTROL',
    [],
    'Una regla de detección levanta una alerta',
    'resourceRef: id de la alerta; reason: regla (severidad)',
  ),
  'security.alert.update': ev(
    'SECURITY',
    'CONTROL',
    [],
    'Triage de una alerta',
    'resourceRef: id de la alerta; reason: estado nuevo y nota',
  ),
  'security.containment.lock': ev(
    'SECURITY',
    'CONTROL',
    [],
    'Bloqueo temporal de la cuenta (automático)',
    'resourceRef: id de la alerta',
  ),
  'security.containment.revoke-sessions': ev(
    'SECURITY',
    'CONTROL',
    [],
    'Revocación de las sesiones de una cuenta',
    'resourceRef: id de la alerta o motivo del ADMIN',
  ),
  'security.containment.disable': ev(
    'SECURITY',
    'CONTROL',
    [],
    'Deshabilitación de una cuenta',
    'reason: motivo',
  ),
  'security.recovery.enable': ev(
    'SECURITY',
    'CONTROL',
    [],
    'Rehabilitación de una cuenta',
    'reason: motivo',
  ),
  'security.containment.revoke-all-sessions': ev(
    'SECURITY',
    'CONTROL',
    [],
    'Revocación global de sesiones (script)',
    '—',
  ),

  // ── System ──────────────────────────────────────────────────────────────
  'incident.snapshot': ev(
    'SYSTEM',
    'CONTROL',
    ['registro de auditoría'],
    'Preservación de evidencia con manifiesto SHA-256',
    'resourceRef: prefijo del hash del manifiesto',
  ),
  'audit.retention.purge': ev(
    'SYSTEM',
    'CONTROL',
    ['registro de auditoría'],
    'Purga por plazo de conservación',
    'reason: filas y plazo',
  ),
  'system.role.set': ev(
    'SYSTEM',
    'CONTROL',
    [],
    'Cambio de rol desde la consola del operador',
    'reason: rol nuevo',
  ),
};

/** Permission denials are recorded as `denied <METHOD> <route>` (PermissionsGuard). */
export const DENIED_PREFIX = 'denied ';
const DENIED_DEF = ev(
  'SECURITY',
  'CONTROL',
  [],
  'Acceso denegado por permisos (RBAC)',
  'action: denied <MÉTODO> <ruta>',
);

export function auditEventDef(action: string): AuditEventDef | undefined {
  if (action.startsWith(DENIED_PREFIX)) return DENIED_DEF;
  return AUDIT_EVENTS[action];
}

export function isCatalogued(action: string): boolean {
  return auditEventDef(action) !== undefined;
}
