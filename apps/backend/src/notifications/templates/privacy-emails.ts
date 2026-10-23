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
} as const;

export function renderRightsResponseEmail(p: {
  displayName: string;
  requestId: string;
  type: keyof typeof TYPE_LABEL;
  outcome: 'FULFILLED' | 'DENIED';
  message: string | null;
}): Rendered {
  const label = TYPE_LABEL[p.type];
  const subject = `Respuesta a tu solicitud de ${label} (${p.requestId.slice(0, 8)})`;
  const lines =
    p.outcome === 'FULFILLED'
      ? [
          `Hola ${p.displayName},`,
          `Tu solicitud de ${label} n.º ${p.requestId} fue atendida.`,
          p.type === 'ERASURE'
            ? 'Tu cuenta y tus datos fueron eliminados. Si tenías compras o ventas cerradas, esos registros se conservan anonimizados por obligación tributaria (6 años).'
            : p.type === 'ACCESS'
              ? 'La copia de tus datos se descargó en la app en formato JSON. No guardamos una copia de esa exportación.'
              : 'Los cambios ya están aplicados en tu cuenta.',
        ]
      : [
          `Hola ${p.displayName},`,
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
