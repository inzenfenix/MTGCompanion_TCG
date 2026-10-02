// Genera el informe del Hito 1 (Inventario y Clasificación de Datos Personales)
// como .docx. Uso:
//   NODE_PATH=<dir con docx@9 instalado> node build_informe.js [pages.json]
// pages.json (opcional) trae el número de página de cada sección para el índice;
// lo produce make_informe.sh tras una primera pasada (ver ese script).
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, PageOrientation, Footer, PageNumber, ImageRun, PageBreak,
  LevelFormat, PositionalTab, PositionalTabAlignment, PositionalTabRelativeTo, PositionalTabLeader,
  VerticalAlign, Tab, TabStopType, LeaderType,
} = require('docx');

const HERE = __dirname;
const pages = process.argv[2] && fs.existsSync(process.argv[2]) ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : {};

const FONT = 'Calibri';
const BODY = 22; // 11 pt
const TABLE = 20; // 10 pt en tablas anchas, interlineado simple
const A4 = { width: 11906, height: 16838 };
const MARGIN = 1417; // 2,5 cm
const W_PORTRAIT = A4.width - 2 * MARGIN; // 9072
const W_LANDSCAPE = A4.height - 2 * MARGIN; // 14004

// ── helpers ────────────────────────────────────────────────────────────
// Texto con **negrita** y ~cursiva~ mínimas (no '_': rompería user_settings, MAPEO_CIA.md…).
function runs(text, opts = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|~[^~]+~)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...opts }));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(new TextRun({ ...opts, text: tok.slice(2, -2), bold: true }));
    else out.push(new TextRun({ ...opts, text: tok.slice(1, -1), italics: true }));
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...opts }));
  return out;
}
const P = (text, o = {}) => new Paragraph({ children: runs(text), alignment: AlignmentType.JUSTIFIED, spacing: { after: 120 }, ...o });
const Bullet = (text, line) => new Paragraph({ children: runs(text), numbering: { reference: 'bullets', level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 60, ...(line ? { line } : {}) } });
const Ref = (text) => Bullet(text, 276);
const H1 = (text, newPage = false) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: newPage, keepNext: true, children: [new TextRun(text)] });
const H2 = (text, newPage = false) => new Paragraph({ heading: HeadingLevel.HEADING_2, pageBreakBefore: newPage, keepNext: true, children: [new TextRun(text)] });
const Caption = (text) => new Paragraph({ children: runs(text, { size: 20, italics: true }), spacing: { before: 60, after: 160 }, alignment: AlignmentType.LEFT });

const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const borders = { top: border, bottom: border, left: border, right: border };
function cell(text, width, { header = false, size = TABLE } = {}) {
  const paras = String(text).split('\n').map((line) => new Paragraph({
    children: runs(line, header ? { size, bold: true } : { size }),
    spacing: { before: 0, after: 0, line: 240 },
  }));
  return new TableCell({
    children: paras,
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: { top: 30, bottom: 30, left: 70, right: 70 },
    verticalAlign: VerticalAlign.TOP,
    shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E7E6E6' } : undefined,
  });
}
function table(headers, rows, widths, size = TABLE) {
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((h, i) => cell(h, widths[i], { header: true, size })) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, widths[i], { size })) })),
    ],
  });
}
const footer = new Footer({
  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 20 })] })],
});
const MARGIN_V = 1134; // 2 cm arriba/abajo (la pauta no fija márgenes)
const portrait = { page: { size: A4, margin: { top: MARGIN_V, bottom: MARGIN_V, left: MARGIN, right: MARGIN } } };
const landscape = { page: { size: { ...A4, orientation: PageOrientation.LANDSCAPE }, margin: { top: MARGIN_V, bottom: MARGIN_V, left: MARGIN, right: MARGIN } } };

// ── contenido ──────────────────────────────────────────────────────────
const SECTIONS = [
  '1. Portada', '2. Índice', '3. Introducción', '4. Inventario de datos personales', '5. Mapa de flujos de datos',
  '6. Clasificación por sensibilidad', '7. Finalidad y base de licitud', '8. Conclusiones', '9. Referencias',
  '10. Anexos', 'Anexo A — Actividad N°1: Mapeo de actores, datos y riesgos CIA', 'Anexo B — Actividad N°2: Cifrado, hashing y tokenización',
];

const cover = [
  new Paragraph({ spacing: { before: 1800 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Universidad del Desarrollo', size: 28 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1200 }, children: [new TextRun({ text: 'Seguridad y Protección de Datos', size: 28 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Hito 1', size: 32, bold: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1200 }, children: [new TextRun({ text: 'Inventario y Clasificación de Datos Personales', size: 40, bold: true })] }),
  ...[
    ['Caso elegido', 'MTG Companion — app de intercambio y compraventa de cartas de Magic: The Gathering'],
    ['Grupo', 'MTG Companion'],
    ['Integrantes', 'Vicente Fuentes · Tomás Rodriguez · Tomás Solano'],
    ['Fecha', '2 de octubre de 2026'],
  ].map(([k, v]) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: `${k}: `, bold: true, size: 24 }), new TextRun({ text: v, size: 24 })] })),
];

const indexEntries = SECTIONS.map((s) => new Paragraph({
  spacing: { after: 80 },
  indent: s.startsWith('Anexo') ? { left: 400 } : undefined,
  tabStops: [{ type: TabStopType.RIGHT, position: W_PORTRAIT, leader: LeaderType.DOT }],
  children: [new TextRun({ text: s, size: BODY }), new TextRun({ children: [new Tab(), String(pages[s] ?? '–')], size: BODY })],
}));

const intro = [
  H1('3. Introducción', true),
  P('**MTG Companion** es una aplicación móvil (Android) para jugadores de ~Magic: The Gathering~. Permite escanear una carta para identificarla y estimar su condición y precio; guardarla en una colección personal (la "Bóveda"); publicarla en un mercado entre jugadores (el "Bazaar") con búsqueda por cercanía; recibir ofertas; pagar con MercadoPago o en efectivo; y confirmar la entrega con un código QR firmado. Incluye segundo factor de autenticación (2FA) y una ruleta de cupones.'),
  P('Relevante para este informe: **el reconocimiento de cartas ocurre íntegramente en el teléfono** (cuatro modelos de IA locales), así que las imágenes de la cámara no llegan al servidor salvo que el usuario publique una foto. El servidor (API NestJS con PostgreSQL) solo guarda lo que el usuario decide registrar y se aloja en Amazon Web Services, región us-east-1 (Estados Unidos).'),
  P('**Actores que participan:**'),
  Bullet('**Jugador (titular):** vendedor, comprador o postor según la operación; puede ser menor de edad (sección 6).'),
  Bullet('**MTG Companion (responsable):** el equipo que opera la app y el servidor y decide fines y medios del tratamiento.'),
  Bullet('**Administrador del sistema:** miembro del equipo con acceso a la nube y a sus secretos.'),
  Bullet('**Amazon Web Services (encargado):** aloja servidor, base de datos, fotos (S3) y secretos.'),
  Bullet('**Proveedor de correo (encargado):** envía bienvenidas y comprobantes de pago.'),
  Bullet('**MercadoPago (tercero, responsable propio):** procesa el pago; la tarjeta se ingresa en su plataforma.'),
  Bullet('**Otros jugadores (destinatarios):** ven nombre visible, cartas publicadas con foto, ofertas y distancia.'),
  Bullet('**Scryfall (API externa de catálogo):** la app **no se conecta a ella**; el catálogo se importa sin conexión a la base propia, así que no recibe datos ni la IP de los jugadores (el Anexo A la suponía en tiempo real; el código usa una copia local).'),
  P('**Marco normativo.** Hoy rige la Ley 19.628; la Ley 21.719 (D.O. 13-12-2024) reemplaza buena parte de su texto desde el 1 de diciembre de 2026 (Ley 21.719, artículo primero transitorio). Como la app operará bajo la nueva norma, se analiza con el texto de la Ley 19.628 **modificado por la Ley 21.719**. Como un mismo número cambia de materia entre ambos textos (el art. 12 vigente trata del acceso; el nuevo, del consentimiento), se cita "Ley 19.628 (texto Ley 21.719), art. X" la primera vez en cada sección y "Ley 19.628, art. X" después y en tablas; el texto actual se indica como "texto vigente".'),
];

const W_INV = [1350, 1700, 1450, 1800, 1950, 2350, 1650, 1754]; // = 14004
const inventoryRows = [
  ['Identificación', 'Correo electrónico', 'Formulario de registro', 'Tabla users (PostgreSQL)', 'Identificar la cuenta, iniciar sesión, enviar correos transaccionales', 'Contrato (Ley 19.628, art. 13 c)', 'Proveedor de correo y AWS (encargados)', 'Mientras la cuenta esté activa (*)'],
  ['Identificación', 'Nombre visible', 'Formulario de registro', 'Tabla users', 'Identificarlo ante su contraparte', 'Contrato (Ley 19.628, art. 13 c)', 'Otros jugadores (visible en el Bazaar)', 'Mientras la cuenta esté activa (*)'],
  ['Credenciales', 'Contraseña (solo su hash bcrypt)', 'Formulario de registro', 'Tabla users', 'Autenticar al usuario', 'Contrato (Ley 19.628, art. 13 c)', 'No se comparte', 'Mientras la cuenta esté activa (*)'],
  ['Credenciales', 'Secreto 2FA (TOTP), cifrado', 'Generado por el servidor al activar 2FA', 'Tabla user_settings', 'Verificar el código del segundo factor', 'Consentimiento (Ley 19.628, art. 12): 2FA es opcional', 'No se comparte', 'Hasta desactivar 2FA (se borra) o cerrar la cuenta'],
  ['Sesión', 'Tokens de sesión (acceso 15 min; renovación 30 días, guardado como hash)', 'Generados por el servidor al iniciar sesión', 'Tabla refresh_tokens y almacenamiento local', 'Mantener la sesión iniciada', 'Contrato (Ley 19.628, art. 13 c)', 'No se comparte', '15 minutos / 30 días; los vencidos se eliminan (*)'],
  ['Preferencias', 'Idioma, tema visual, aviso por correo', 'Usuario', 'Tabla user_settings', 'Personalizar la aplicación', 'Contrato (Ley 19.628, art. 13 c)', 'No se comparte', 'Mientras la cuenta esté activa (*)'],
  ['Geolocalización', 'Latitud y longitud del vendedor (cifradas)', 'GPS del teléfono, previo permiso', 'Tabla user_settings', 'Mostrar a otros jugadores la distancia hasta el vendedor', 'Consentimiento (Ley 19.628, arts. 12 y 16 sexies)', 'No; a otros solo se les muestra la distancia en km', 'Hasta su revocación o 30 días sin actualizar (*)'],
  ['Geolocalización', 'Posición del comprador al buscar', 'GPS del teléfono', 'No se almacena (viaja solo en la consulta)', 'Ordenar resultados por distancia', 'Consentimiento (Ley 19.628, arts. 12 y 16 sexies)', 'No se comparte', 'No se conserva'],
  ['Imagen', 'Fotogramas del escáner en vivo', 'Cámara del teléfono', 'Solo memoria del teléfono', 'Identificar la carta con IA local', 'No aplica: el responsable no los recolecta (sección 7, F2)', 'No se comparte', 'No se conserva'],
  ['Imagen', 'Foto de la carta tomada para publicar', 'Cámara del teléfono (foto manual)', 'Archivo temporal del teléfono; al publicar, AWS S3 (bucket privado)', 'Mostrar al comprador el estado real de la carta', 'Contrato (Ley 19.628, art. 13 c)', 'Compradores (enlace temporal); AWS', 'Teléfono: hasta que se limpie la caché; S3: mientras exista la publicación'],
  ['Patrimonio', 'Colección y mazos', 'Usuario e IA del teléfono', 'Tablas cards y decks', 'Organizar la colección y publicar cartas', 'Contrato (Ley 19.628, art. 13 c)', 'Solo las cartas publicadas son visibles', 'Mientras la cuenta esté activa (*)'],
  ['Comercial', 'Ofertas y pujas (monto, fecha, postor)', 'Usuario', 'Tabla offers', 'Gestionar subastas y ofertas', 'Contrato (Ley 19.628, art. 13 c)', 'Vendedor de la carta', 'Mientras exista la publicación'],
  ['Financiero', 'Transacciones (partes, monto, método y estado)', 'Servidor, al concretar una compra', 'Tabla transactions', 'Registrar la compraventa y su comprobante', 'Contrato (Ley 19.628, art. 13 c); pagos por MercadoPago: obligación legal (art. 13 b; DL 830) (**)', 'Contraparte; MercadoPago (id, título, monto); correo', 'MercadoPago: 6 años desde el pago (*)(**); efectivo: mientras la cuenta esté activa (*)'],
  ['Financiero', 'Referencia de pago (token de MercadoPago)', 'MercadoPago', 'Tabla transactions', 'Consultar el pago sin manejar la tarjeta', 'Contrato (Ley 19.628, art. 13 c)', 'MercadoPago', 'Igual que la transacción'],
  ['Financiero', 'Datos de tarjeta', 'Usuario, en el checkout de MercadoPago', 'Solo en MercadoPago (nunca en el sistema)', 'Pagar la compra', 'Contrato del usuario con MercadoPago', 'MercadoPago (responsable propio)', 'No se conservan en el sistema'],
  ['Beneficios', 'Cupones (descuento, vencimiento, canje)', 'Ruleta de premios del servidor', 'Tabla coupons', 'Otorgar y canjear promociones', 'Contrato (bases de la promoción)', 'No se comparte', 'Hasta vencer; si se canjeó, igual que la transacción (*)'],
  ['Técnico', 'Dirección IP', 'Conexión de red', 'No la registra la aplicación', 'Entregar el servicio por internet', 'Interés legítimo (Ley 19.628, art. 13 d); ponderación en sección 7', 'AWS (infraestructura)', 'No se conserva en el sistema'],
];
const inventory = [
  H1('4. Inventario de datos personales'),
  P('Construido a partir del esquema real de la base de datos, el código de la app y sus integraciones. Las bases de licitud se justifican en la sección 7.', { spacing: { after: 60 } }),
  table(['Categoría de dato', 'Dato específico', 'Fuente', 'Ubicación de almacenamiento', 'Finalidad', 'Base de licitud', 'Con quién se comparte', 'Plazo de conservación'], inventoryRows, W_INV),
  Caption('(*) Política del grupo que el sistema **aún no aplica**: hoy se conserva indefinidamente (sección 8). (**) A confirmar: sección 7 (F4) y dudas abiertas.'),
];

const W_FLOW = [1900, 2400, 2700, 2600, 4404]; // = 14004
const flows = [
  H1('5. Mapa de flujos de datos', true),
  P('Cuatro flujos principales: dónde nace cada dato, qué sistema lo procesa y dónde termina. La tabla siguiente detalla cada transformación.', { spacing: { after: 0 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new ImageRun({ type: 'png', data: fs.readFileSync(path.join(HERE, 'diagrama_flujos.png')), transformation: { width: 790, height: 484 } })],
  }),
  Caption('Figura 1. Mapa de flujos de datos personales de MTG Companion (F1 a F4).'),
  table(['Flujo', 'Origen', 'Actor / sistema', 'Destino', 'Transformación'], [
    ['**F1** Registro y autenticación', 'Formulario de registro / login en el teléfono', 'Backend (módulos de usuarios y autenticación)', 'PostgreSQL (users, user_settings, refresh_tokens); proveedor de correo', 'Contraseña → hash bcrypt (costo 12). Secreto 2FA generado y cifrado AES-256-GCM. Tokens: acceso firmado HMAC-SHA256; renovación guardada como hash SHA-256. Email → correo de bienvenida.'],
    ['**F2** Escaneo y publicación', 'Cámara del teléfono', 'IA en el teléfono (ONNX); luego backend', 'Teléfono (nada); al publicar: PostgreSQL (cards) y S3 (foto)', 'Los fotogramas del escáner se procesan en memoria y se descartan. La foto manual queda como archivo temporal del teléfono; al publicar, solo sube esa foto y los datos de la carta, a un bucket privado que la muestra con un enlace firmado temporal.'],
    ['**F3** Búsqueda con ubicación', 'GPS del teléfono, con permiso', 'Backend (módulos de usuarios y cartas)', 'PostgreSQL (user_settings); al comprador solo la distancia', 'Coordenadas del vendedor → cifradas AES-256-GCM. En una búsqueda se descifran en memoria solo para calcular la distancia (fórmula de haversine); la respuesta lleva km, nunca coordenadas.'],
    ['**F4** Compraventa y pago', 'Compra u oferta del jugador', 'Backend (transacciones, pagos) y MercadoPago', 'PostgreSQL (transactions); MercadoPago; proveedor de correo; contraparte', 'A MercadoPago solo va id, título y monto; la tarjeta se ingresa en su sitio (tokenización: se guarda solo la referencia). El aviso de pago se valida por firma HMAC. Se envía comprobante a ambas partes y la entrega se confirma con un QR firmado que vence en 3 minutos.'],
  ], W_FLOW),
  P('Scryfall no participa en estos flujos: el catálogo de cartas se importa sin conexión y no lleva datos de jugadores (ver Introducción).', { spacing: { before: 80, after: 60 } }),
  H2('Detalle del flujo F3 (el más delicado)'),
  P('Al abrir el Bazaar la app pide el permiso de ubicación. Si se concede, el teléfono envía latitud y longitud; el servidor las **cifra antes de guardarlas**. Cuando otro jugador busca con su propia posición, el servidor descifra la del vendedor **solo en memoria**, calcula la distancia y responde únicamente con kilómetros; la posición del comprador no se guarda. Riesgo: con varias búsquedas desde puntos distintos se podría triangular al vendedor, por lo que se propone redondear las coordenadas (sección 8).'),
];

const W_CLS = [2300, 1700, 5072]; // = 9072
const classification = [
  H1('6. Clasificación por sensibilidad'),
  P('Es **dato personal** la información "vinculada o referida a una persona natural identificada o identificable" (Ley 19.628 (texto Ley 21.719), art. 2 letra f); **sensible**, la que revela, entre otros, la situación socioeconómica, la salud o datos biométricos (art. 2 letra g). Son **categorías especiales** los datos biométricos (art. 16 ter), de menores (art. 16 quáter) y de geolocalización (art. 16 sexies).'),
  table(['Dato', 'Clasificación', 'Justificación'], [
    ['Correo electrónico, nombre visible', 'Personal', 'Identifican al titular (Ley 19.628, art. 2 f); no revelan su intimidad, así que no son sensibles.'],
    ['Contraseña (hash), secreto 2FA, tokens de sesión', 'Personal', 'No figuran en la Ley 19.628, art. 2 g, pero son **críticos**: permiten suplantar al jugador; por eso reciben la mayor protección técnica (Ley 19.628, art. 14 quinquies).'],
    ['Preferencias (idioma, tema, avisos)', 'Personal', 'Vinculadas a la cuenta; bajo riesgo.'],
    ['Ubicación del vendedor y del comprador', '**Categoría especial: geolocalización**', 'La Ley 19.628, art. 16 sexies, exige informar tipo de dato, finalidad, duración y si se comunica a terceros. Permite inferir domicilio y hábitos, por lo que recibe protección reforzada aunque no esté en el art. 2 g.'],
    ['Fotogramas del escáner y fotos para publicar', 'Personal (incidental); **no biométrico**', 'Pueden captar manos, rostros o el hogar. No son biométricos: la Ley 19.628, art. 16 ter, exige un "tratamiento técnico específico" que identifique a la persona; la IA solo reconoce cartas.'],
    ['Colección, ofertas, transacciones y cupones', 'Personal; **riesgo de sensible**', 'Una compra aislada no revela la situación socioeconómica; sumados, el valor de la colección y las compras podrían revelarla (Ley 19.628, art. 2 g). No se perfilan y se tratan como alto riesgo.'],
    ['Datos de tarjeta y referencia de pago (token de MercadoPago)', 'Personal (financiero)', 'La tarjeta la procesa solo MercadoPago. La referencia guardada es personal por vincularse a la transacción de un jugador (Ley 19.628, art. 2 f), pero no sirve fuera de MercadoPago.'],
    ['Dirección IP', 'Personal', 'Permite identificar indirectamente al titular (Ley 19.628, art. 2 f). La aplicación no la registra.'],
    ['Cualquier dato de un usuario menor de 18 años', '**Categoría especial: menores**', 'La Ley 19.628, art. 16 quáter, exige atender al interés superior del menor y, bajo 14 años, consentimiento de padres o representantes. Hay jugadores adolescentes y la app no pregunta la edad.'],
  ], W_CLS),
];

const lawful = [
  H1('7. Finalidad y base de licitud'),
  P('La Ley 19.628 (texto Ley 21.719), art. 13, admite tratar datos sin consentimiento por, entre otras, una obligación legal (letra b), un contrato con el titular (letra c) o un interés legítimo (letra d). Se usó **contrato** cuando el dato es indispensable para el servicio pedido y **consentimiento** solo para lo opcional, porque el art. 12 presume que no es libre el consentimiento exigido para algo que el servicio no necesita. Hoy la autorización debe "constar por escrito" (Ley 19.628, texto vigente, art. 4); el nuevo art. 12 acepta un medio electrónico o un acto afirmativo inequívoco, como activar el 2FA en la app.'),
  H2('F1 — Registro y autenticación'),
  P('**Finalidad:** crear y proteger la cuenta. **Base:** contrato (art. 13 c) para email, nombre, contraseña, tokens y correo de bienvenida: sin ellos no existe la cuenta pedida. El **2FA**, en **consentimiento** (art. 12): es opcional, se activa con un acto afirmativo y se revoca desactivándolo, lo que borra el secreto.'),
  H2('F2 — Escaneo y publicación de cartas'),
  P('**Finalidad:** identificar la carta y, si el jugador quiere, publicarla. **Fotogramas del escáner:** no hay tratamiento del responsable. Tratar es recolectar, procesar, almacenar, comunicar o usar datos (Ley 19.628, art. 2 o) por decisión del responsable (art. 2 n); los fotogramas se procesan en memoria en el teléfono del jugador y se descartan, sin que el responsable los reciba ni guarde. Por eso no se les exige el consentimiento informado que sí se exige a la ubicación, que llega al servidor (F3); el permiso del sistema es un control del jugador sobre su teléfono. Es protección desde el diseño (art. 14 quáter) y proporcionalidad (art. 3 c). **Foto publicada y datos de la carta:** **contrato** (art. 13 c): publicar es el servicio pedido y la foto muestra el estado real de la carta.'),
  H2('F3 — Búsqueda con ubicación'),
  P('**Finalidad:** mostrar a los compradores la distancia a cada vendedor. **Base:** **consentimiento** (arts. 12 y 16 sexies). No puede ser contrato: la búsqueda funciona sin ubicación y exigirla haría presumir un consentimiento no libre (art. 12). Debe ser informado y revocable, pero hoy solo existe el permiso genérico del sistema y no se puede dejar de compartir: es una brecha.'),
  H2('F4 — Compraventa y pago'),
  P('**Finalidad:** ejecutar la compraventa, cobrar y dejar respaldo. **Base:** **contrato** (Ley 19.628, art. 13 c) para crear la transacción, enviar a MercadoPago id, título y monto, y mandar el comprobante: son pasos necesarios de la compraventa que el jugador inicia. **Conservación:** la plataforma no cobra comisión ni es parte de la compraventa, pero en los pagos con MercadoPago **el dinero entra a su cuenta** y lo recauda por cuenta del vendedor, por lo que queda en su contabilidad, que debe conservarse mientras el SII pueda revisarla (DL 830, art. 17), hasta seis años (DL 830, art. 200). Se propone ese plazo como **obligación legal** (art. 13 b) solo para esos pagos, a confirmar (dudas abiertas). En efectivo la plataforma no recibe dinero: rige solo el contrato. La tarjeta la trata MercadoPago bajo su propio contrato. Al estar el servidor en EE.UU. hay **transferencia internacional**, que exige país adecuado o garantías contractuales con AWS (art. 27).'),
  H2('Otros tratamientos (fuera de los cuatro flujos)'),
  P('**Preferencias y cupones:** **contrato** (Ley 19.628, art. 13 c). Las preferencias son ajustes que el jugador pide; el cupón nace cuando decide girar la ruleta bajo las bases de la promoción, y sin registrarlo no se puede canjear ni evitar su doble uso.'),
  P('**Dirección IP:** **interés legítimo** (art. 13 d), ponderado. **Interés:** entregar y proteger el servicio; sin IP el servidor no puede responder. **Necesidad:** no hay alternativa menos intrusiva. **Equilibrio:** la app no la guarda, no la cruza con la cuenta ni perfila con ella; solo AWS la ve, como encargado, al enrutar el tráfico, lo que el jugador razonablemente espera. Así, el interés no prevalece sobre sus derechos; igual puede exigir ser informado (art. 13 d), lo que debe constar en la política de privacidad.'),
];

const conclusions = [
  H1('8. Conclusiones'),
  P('**Datos más críticos.** (1) La **geolocalización** del vendedor, por ser una categoría especial y permitir inferir su domicilio. (2) Las **credenciales** (contraseña, secreto 2FA, tokens), porque su filtración permite suplantar al jugador. (3) El **historial de transacciones y la colección**, que juntos podrían revelar la situación socioeconómica. (4) Los datos de **posibles menores de edad**.'),
  P('**Medidas ya implementadas (Anexo B).** Contraseña con bcrypt; tokens de renovación con SHA-256; secreto 2FA y ubicación cifrados con AES-256-GCM (llave fuera de la base de datos); pago tokenizado; sesión, QR y avisos de pago firmados con HMAC; fotos en bucket privado. Esto va más allá de la "debida diligencia" que hoy exige la Ley 19.628 (texto vigente, art. 11) y apunta al deber de medidas de seguridad apropiadas del nuevo texto (Ley 19.628 (texto Ley 21.719), art. 14 quinquies).'),
  P('**Riesgos y brechas identificadas:**'),
  Bullet('**Conservación indefinida:** sin cierre de cuenta ni limpieza periódica, contra la proporcionalidad (Ley 19.628, art. 3 c) y la supresión (art. 7). Propuesta: cierre de cuenta y tarea que aplique los plazos.'),
  Bullet('**Consentimiento de ubicación incompleto** (arts. 12 y 16 sexies). Propuesta: pantalla explicativa, interruptor que borre las coordenadas y redondeo contra la triangulación.'),
  Bullet('**Sin verificación de edad** (art. 16 quáter). Propuesta: pedir la edad y exigir autorización parental bajo 14 años.'),
    Bullet('**Sin política de privacidad** (art. 14 ter); **transferencia a AWS (EE.UU.)** sin garantías documentadas (art. 27); **tránsito sin TLS**; tokens en almacenamiento local.'),
  P('**Dudas abiertas.** (a) Si el valor agregado de una colección es "situación socioeconómica" (art. 2 g). (b) Cómo acreditar la transferencia a AWS sin lista oficial de países adecuados. (c) Si MercadoPago es responsable independiente o encargado. (d) Qué edad mínima exigir. (e) Si, al recaudar por MercadoPago sin comisión, la plataforma es mandataria del vendedor y le aplica el plazo tributario de 6 años.'),
];

const references = [
  H1('9. Referencias'),
  Ref('Ley 19.628, sobre protección de la vida privada (texto vigente hasta el 30-11-2026), arts. 4 y 11. https://www.bcn.cl/leychile/navegar?idNorma=141599'),
  Ref('Ley 21.719 (D.O. 13-12-2024; vigencia 01-12-2026): artículo primero transitorio y, de la Ley 19.628 en su nuevo texto, arts. 2 (f, g, n, o), 3, 7, 12, 13, 14 ter, 14 quáter, 14 quinquies, 16 ter, 16 quáter, 16 sexies y 27. https://www.bcn.cl/leychile/navegar?idNorma=1209272'),
  Ref('Decreto Ley 830, Código Tributario, artículos 17 y 200. https://www.bcn.cl/leychile/navegar?idNorma=6374'),
  Ref('Repositorio MTG Companion (código, Actividades N°1 y N°2, evidencias): https://github.com/inzenfenix/MTGCompanion_TCG'),
];

// Anexo A: tabla de la Actividad N°1 tal como está en docs/security/MAPEO_CIA.md
function mdTableRows(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('|'));
  return lines.slice(2).map((l) => l.slice(1, -1).split('|').map((c) => c.trim().replace(/\*\*/g, '**')));
}
const repoDocs = path.join(HERE, '..');
const annexA = [
  H1('10. Anexos'),
  H2('Anexo A — Actividad N°1: Mapeo de actores, datos y riesgos CIA'),
  table(['Actor', 'Dato que maneja', 'Atributo CIA en riesgo', 'Por qué'], mdTableRows(path.join(repoDocs, 'MAPEO_CIA.md')), [2600, 3100, 1900, 6404]),
];
const actividad2 = fs.readFileSync(path.join(repoDocs, 'ACTIVIDAD_2.md'), 'utf8');
const itemI = actividad2.split('## ITEM I')[1].split('\n').filter((l) => l.startsWith('|')).slice(2)
  .map((l) => l.slice(1, -1).split('|').map((c) => c.trim().replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, '')));
const annexB = [
  H2('Anexo B — Actividad N°2: Cifrado, hashing y tokenización', true),
  P('Cuadro del Item I de la Actividad N°2. La implementación (Item II), con su código fuente y evidencias, está en docs/security/ACTIVIDAD_2.md del repositorio; en la columna Evidencia, 01 a 05 son los archivos de docs/security/evidencia/.'),
  table(['Campo', 'Necesidad', 'Elección', 'Criterio técnico', 'Implementación', 'Evidencia'], itemI, [2100, 2200, 1700, 3200, 2904, 1900]),
];

const doc = new Document({
  creator: 'Grupo MTG Companion',
  title: 'Hito 1 — Inventario y Clasificación de Datos Personales',
  styles: {
    default: { document: { run: { font: FONT, size: BODY }, paragraph: { spacing: { line: 360 } } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, font: FONT }, paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, font: FONT }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] },
  sections: [
    { properties: portrait, children: cover },
    { properties: portrait, footers: { default: footer }, children: [H1('2. Índice'), ...indexEntries, ...intro] },
    { properties: landscape, footers: { default: footer }, children: [...inventory, ...flows] },
    { properties: portrait, footers: { default: footer }, children: [...classification, ...lawful, ...conclusions, ...references] },
    { properties: landscape, footers: { default: footer }, children: [...annexA, ...annexB] },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(HERE, 'Hito1_Inventario_Datos_Personales.docx');
  fs.writeFileSync(out, buf);
  console.log('wrote', out);
});
