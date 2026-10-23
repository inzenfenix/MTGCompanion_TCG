/**
 * Shape of the access/portability export (ACTIVIDAD_5.md §2.2) — JSON, the
 * "formato electrónico estructurado, genérico y de uso común" art. 9 asks
 * for: any language parses it, and the `format`/`version` header lets a
 * future version change the shape without breaking whoever reads it.
 *
 * Art. 5 also gives the right to know *why* and *for how long* the data is
 * processed and who receives it — that's `processing`, the same text as the
 * Hito 1 inventory. `notIncluded` lists, with the reason, what the export
 * deliberately leaves out, so the player isn't left wondering.
 */

export const EXPORT_FORMAT = 'mtg-companion/personal-data-export';
export const EXPORT_VERSION = 1;

export const PROCESSING_INFO = [
  {
    data: 'Correo, nombre visible, contraseña (hash), declaración 18+',
    purpose: 'Crear y operar tu cuenta',
    legalBasis: 'Contrato (Ley 19.628, art. 13 c)',
    recipients: 'Proveedor de correo (Amazon SES) para correos de cuenta',
    retention: 'Mientras exista la cuenta',
  },
  {
    data: 'Cartas, mazos, ofertas, cupones',
    purpose: 'Colección y mercado',
    legalBasis: 'Contrato (Ley 19.628, art. 13 c)',
    recipients:
      'Otros jugadores ven tus publicaciones y tu nombre visible; nunca tu correo',
    retention: 'Mientras exista la cuenta',
  },
  {
    data: 'Transacciones',
    purpose: 'Compra y venta, comprobantes',
    legalBasis:
      'Contrato y obligación legal tributaria (Ley 19.628, art. 13 b y c)',
    recipients:
      'La contraparte (nombre visible), MercadoPago si pagas por esa vía',
    retention:
      '6 años (Código Tributario, arts. 17 y 200), incluso tras eliminar la cuenta',
  },
  {
    data: 'Ubicación aproximada',
    purpose: 'Distancia a vendedores en el Bazar',
    legalBasis: 'Consentimiento (Ley 19.628, arts. 12 y 16 sexies)',
    recipients: 'Nadie: solo se usa para calcular una distancia',
    retention: '30 días o hasta que revoques',
  },
  {
    data: 'Secreto 2FA',
    purpose: 'Verificación en dos pasos',
    legalBasis: 'Consentimiento (Ley 19.628, art. 12)',
    recipients: 'Nadie',
    retention: 'Hasta que desactives 2FA',
  },
];

export const NOT_INCLUDED = [
  {
    what: 'Hash de contraseña, secreto 2FA, tokens de sesión',
    why: 'Son credenciales: entregarlas, aunque sea a ti, solo crea una copia más que alguien podría robar. No son datos que puedas llevar a otro servicio.',
  },
  {
    what: 'Datos de otros jugadores (id, correo, ofertas de terceros por tus cartas)',
    why: 'Son datos personales de otras personas. De tu contraparte solo aparece el nombre visible que la app ya te muestra.',
  },
  {
    what: 'Registro de auditoría y alertas de seguridad',
    why: 'Están seudonimizados y existen para investigar incidentes; entregarlos revelaría cómo se detectan los abusos. Puedes pedir información específica sobre ellos por escrito.',
  },
  {
    what: 'Referencias internas de pago (paymentRef)',
    why: 'Identificadores del proveedor de pagos, no datos tuyos; tu comprobante ya trae monto, medio y estado.',
  },
];
