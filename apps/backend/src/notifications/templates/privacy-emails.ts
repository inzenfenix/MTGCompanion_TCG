/**
 * ROADMAP.md O15 emails. Written in Spanish: they answer obligations under
 * Chilean law (Ley 19.628, texto Ley 21.719) and are the written answer
 * art. 11 asks for. None of them carries more personal data than the
 * recipient already has — no other user's data, no ids beyond the
 * request/alert number needed to follow up.
 */

interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function wrap(title: string, paragraphs: string[]): string {
  return `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
      <h2 style="color:#7a1f2b;">${escape(title)}</h2>
      ${paragraphs.map((p) => `<p>${escape(p)}</p>`).join('\n      ')}
      <p style="color:#888; font-size: 12px;">— MTG Companion</p>
    </div>`.trim();
}

const TYPE_LABEL = {
  ACCESS: 'acceso y portabilidad',
  RECTIFICATION: 'rectificación',
  ERASURE: 'supresión',
  OBJECTION: 'oposición',
  BLOCKING: 'bloqueo temporal',
} as const;

export function renderRightsResponseEmail(p: {
  displayName: string;
  requestId: string;
  type: keyof typeof TYPE_LABEL;
  outcome: 'FULFILLED' | 'DENIED';
  message: string | null;
  effect?: string | null;
  awaitingStepUp?: boolean;
}): Rendered {
  const label = TYPE_LABEL[p.type];
  const hello = p.displayName ? `Hola ${p.displayName},` : 'Hola,';
  if (p.awaitingStepUp) {
    // O16: confirmed from the mailbox, but this type needs the password too.
    const subject = `Completa tu solicitud de ${label} (${p.requestId.slice(0, 8)})`;
    const lines = [
      hello,
      `Confirmaste la solicitud de ${label} n.º ${p.requestId}.`,
      'Para atenderla necesitamos una verificación más fuerte: inicia sesión en la app, abre Privacidad y mis datos → Mis solicitudes y pulsa "Completar". Te pediremos tu contraseña (y tu código 2FA si lo tienes activo).',
      'Si no la completas en 14 días, se cerrará sin cambios y podrás enviarla de nuevo.',
    ];
    return { subject, html: wrap(subject, lines), text: lines.join('\n\n') };
  }
  const subject = `Respuesta a tu solicitud de ${label} (${p.requestId.slice(0, 8)})`;
  const lines =
    p.outcome === 'FULFILLED'
      ? [
          hello,
          `Tu solicitud de ${label} n.º ${p.requestId} fue atendida.`,
          p.type === 'ERASURE'
            ? 'Tu cuenta y tus datos fueron eliminados. Si tenías compras o ventas cerradas, esos registros se conservan anonimizados por obligación tributaria (6 años).'
            : p.type === 'ACCESS'
              ? 'La copia de tus datos se descargó en la app en formato JSON. No guardamos una copia de esa exportación.'
              : p.type === 'OBJECTION' || p.type === 'BLOCKING'
                ? (p.effect ?? 'La medida ya está en efecto.') +
                  ' Puedes retirarla cuando quieras en Privacidad y mis datos.'
                : 'Los cambios ya están aplicados en tu cuenta.',
        ]
      : [
          hello,
          `No pudimos atender tu solicitud de ${label} n.º ${p.requestId}.`,
          `Motivo: ${p.message ?? 'no especificado'}`,
          'Si no estás de acuerdo, puedes presentar un reclamo ante la Agencia de Protección de Datos Personales dentro de 30 días hábiles (Ley 19.628, art. 11).',
        ];
  return { subject, html: wrap(subject, lines), text: lines.join('\n\n') };
}

export function renderEmailChangedEmail(displayName: string): Rendered {
  const subject = 'El correo de tu cuenta MTG Companion cambió';
  const lines = [
    `Hola ${displayName},`,
    'El correo asociado a tu cuenta se cambió por otro y todas las sesiones abiertas se cerraron.',
    'Si fuiste tú, no tienes que hacer nada. Si no fuiste tú, responde a este correo de inmediato: tu cuenta podría estar comprometida.',
  ];
  return { subject, html: wrap(subject, lines), text: lines.join('\n\n') };
}

export function renderSecurityAlertEmail(p: {
  alertId: string;
  rule: string;
  severity: string;
}): Rendered {
  const subject = `[${p.severity}] Alerta de seguridad: ${p.rule}`;
  const lines = [
    `Se generó la alerta ${p.alertId} (regla ${p.rule}, severidad ${p.severity}).`,
    'Revísala en GET /admin/security/alerts y sigue el plan de respuesta a incidentes (docs/security/ACTIVIDAD_5.md §4).',
  ];
  return { subject, html: wrap(subject, lines), text: lines.join('\n\n') };
}

export function renderOfferReceivedEmail(p: {
  displayName: string;
  cardTitle: string;
  amount: number;
}): Rendered {
  const subject = `Nueva oferta por ${p.cardTitle}`;
  const lines = [
    `Hola ${p.displayName},`,
    `Alguien ofreció $${p.amount} por tu carta "${p.cardTitle}".`,
    'Recibes este correo porque activaste los correos opcionales. Puedes desactivarlos cuando quieras en Privacidad.',
  ];
  return { subject, html: wrap(subject, lines), text: lines.join('\n\n') };
}

/**
 * O16 (ACTIVIDAD_6.md §1–2) — confirmation code for a request sent through
 * the public form. Says what was asked, so the holder recognises it, and
 * what to do if it wasn't them.
 */
export function renderRightsConfirmationEmail(p: {
  displayName: string;
  requestId: string;
  type: string;
  code: string;
  expiresAt: Date;
  confirmUrl?: string;
}): Rendered {
  const label =
    TYPE_LABEL[p.type as keyof typeof TYPE_LABEL] ?? p.type.toLowerCase();
  const subject = `Confirma tu solicitud de ${label}`;
  const lines = [
    `Hola ${p.displayName},`,
    `Recibimos por el formulario de privacidad una solicitud de ${label} (n.º ${p.requestId}) para la cuenta asociada a este correo.`,
    'Para verificar que la enviaste tú, ingresa este código en la app (Privacidad → "¿No puedes entrar?" → Confirmar):',
    p.code,
    ...(p.confirmUrl ? [`O abre este enlace: ${p.confirmUrl}`] : []),
    `El código sirve una sola vez y vence el ${p.expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC. Hasta que lo confirmes no haremos nada con la solicitud.`,
    'Si no la enviaste tú, ignora este correo: sin el código la solicitud se cierra sola y tu cuenta no cambia.',
  ];
  return { subject, html: wrap(subject, lines), text: lines.join('\n\n') };
}
