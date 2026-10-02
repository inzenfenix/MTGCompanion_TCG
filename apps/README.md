# MTG Card Scanner — Examen final ("MTG Companion")

> Updated 2026-09-11. For a categorized deep-dive per area (models, tools,
> each sub-app, infra, environment, known decisions/gotchas), see
> [`docs/context/README.md`](../docs/context/README.md) — this file stays a high-level overview;
> `docs/context/` is the place to go before making a non-trivial change.

## Restricciones conocidas (indicadas por el profesor)

- La aplicación final debe estar construida en **Ionic**.
- Debe usar **OpenCV.js** y correr inferencia **del lado del cliente**
  (navegador / app), no como un script de Python. El profesor mencionó
  TensorFlow.js como ruta; el equipo optó por **ONNX + `onnxruntime-web`**
  en su lugar (ver sección siguiente) porque cubre ambos frameworks del
  proyecto (PyTorch y TensorFlow), no solo uno.
- La aplicación debe tener **uso comercial** real, no ser solo una demo técnica.
- Presentación con interrogación oral individual — la nota de aprobación
  depende de aprobar esa interrogación (o sea: cada integrante tiene que poder
  explicar el sistema completo, no solo "su" parte).

## Propuesta comercial: "MTG Companion"

Una app para coleccionistas y vendedores de Magic: escanean una carta con la
cámara del celular y la app la identifica al instante, muestra su precio
estimado de mercado, y lleva el inventario de su colección (valor total,
cartas que faltan para completar un mazo, etc.), además de un flujo de
compraventa entre usuarios (QR, ofertas, cupones).

Esto responde directamente al pedido de uso comercial del profesor: es la
misma tecnología de Certamen 1 + Certamen 2 (identificación, validación de
texto, precio, condición), pero empaquetada como una herramienta que un
vendedor de cartas usaría en la práctica — no solo un ejercicio de
clasificación.

Modelo de negocio de referencia (freemium):
- **Gratis**: escanear e identificar una carta.
- **Pago**: historial de precio, valorización total de la colección, alertas
  de precio, exportar el inventario.

## Estado actual — las 4 etapas están entrenadas, exportadas y conectadas

Las 4 etapas del pipeline (detector MTG/no-MTG, validador de texto/OCR,
estimador de precio, calificador de condición) están entrenadas en ambos
frameworks, exportadas a ONNX, y publicadas en
`apps/mobile/public/models/`. El detalle exacto de qué archivo usa qué
checkpoint, y las asimetrías entre frameworks (p. ej. Stage 3 es
PyTorch-only del lado del cliente), está en
[`docs/context/models/README.md`](../docs/context/models/README.md) — no se repite acá para no
volver a quedar desactualizado.

## Arquitectura base

```
┌───────────────────────────── Ionic React (Capacitor) ─────────────────────────────┐
│                                                                                     │
│  Cámara (getUserMedia/Capacitor Camera)                                           │
│    → OpenCV.js: cardLocalizer.ts (recorte/perspectiva/CLAHE)                      │
│    → onnxruntime-web: Stage 1 (detector) → Stage 2 (validador de texto)           │
│      → Stage 3 (precio, PyTorch-only) → Stage 4 (condición)                       │
│    → tesseract.js (OCR en el navegador) + búsqueda en el catálogo                 │
│      (identifyCard.ts) → carta identificada + condición + precio estimado         │
│                                                                                     │
└──────────────────────────────────────┬────────────────────────────────────────────┘
                                        │ cuenta / cartas guardadas / transacciones / ofertas / decks
                                        ▼
                    ┌───────────────────────────────────────────┐
                    │  Backend NestJS (backend/)                 │
                    │  Prisma + PostgreSQL + S3-compatible storage │
                    └───────────────────────────────────────────┘
```

Detalle completo del pipeline de 4 etapas en el `CLAUDE.md` de la raíz del
repo (tabla del pipeline) y en [`docs/context/models/README.md`](../docs/context/models/README.md).
Este documento cubre solo la parte específica de la app final.

**La inferencia (Stage 1–4) es 100% del lado del cliente** — el backend no
participa del escaneo/identificación, solo persiste lo que el usuario ya
decidió guardar: su cuenta, las cartas de su colección (con foto), sus
mazos/Bóveda, y las transacciones/ofertas de compra-venta con otros
usuarios. Ver [`docs/context/apps/README.md`](../docs/context/apps/README.md) — este invariante
(inferencia nunca en el backend) es intencional, no un límite temporal.

### Por qué ONNX (no TensorFlow.js) para lo que corre en el cliente

Certamen 2 duplica cada etapa en PyTorch y TensorFlow y elige el ganador por
métrica (no necesariamente el mismo framework en todas las etapas). Atarse a
TensorFlow.js habría obligado a descartar el resultado si PyTorch ganaba
alguna etapa. Con **ONNX** como formato de exportación común (`torch.onnx.export`
para PyTorch, `tf2onnx` para TensorFlow) y **`onnxruntime-web`** como runtime en
el cliente, la app corre el modelo que efectivamente ganó cada etapa sin
importar en qué framework se entrenó. Más contexto en
[`docs/context/decisions/README.md`](../docs/context/decisions/README.md).

### Cómo se resolvió "identificar qué carta del catálogo es"

En vez de un índice de vecinos más cercanos por embedding visual sobre las
~58,679 cartas del catálogo (medido en solo ~18–25% Top-1 en fotos reales,
no rentable de servir), se optó por OCR del nombre + búsqueda en el
catálogo + OCR del texto de reglas + segunda búsqueda + rerank con Stage 2
(`src/lib/scan/identifyCard.ts`). Corre enteramente del lado del cliente. Ver
[`docs/context/decisions/README.md`](../docs/context/decisions/README.md) para el razonamiento
completo.

## Qué queda pendiente (lista corta — ver `docs/context/` y `ROADMAP.md` para el detalle)

- El cliente todavía no consume `POST /auth/refresh` ni el desafío de 2FA
  (`{twoFactorRequired: true}`) que ya expone el backend — cierra sesión en
  cualquier 401 en vez de refrescar primero, y `SecuritySettings.tsx` sigue
  siendo un mock estático. Ver [`docs/context/apps/backend.md`](../docs/context/apps/backend.md).
- No hay un round-trip de MercadoPago probado en vivo end-to-end (falta un
  `MERCADOPAGO_ACCESS_TOKEN`/`MERCADOPAGO_WEBHOOK_SECRET` de sandbox en este
  repo, y `localhost` no puede recibir el webhook sin un túnel público).
- No existe un campo de balance/wallet en `User` — el balance de tesorería
  del Tab 1 sigue siendo un mock fijo.
- `guessedPrice` (Stage 3) lo calcula y envía el cliente sin verificación
  server-side — es una decisión de arquitectura, no un descuido; ver
  [`docs/context/apps/backend.md`](../docs/context/apps/backend.md) si se quiere cambiar.
- El OCR client-side (`ocrExtractor.ts`) todavía no está compuesto con el
  localizador de cartas (`cardLocalizer.ts`) para el caso de una foto con
  fondo — hoy asume una imagen ya recortada. Ver
  [`docs/context/apps/trading-app-ionic.md`](../docs/context/apps/trading-app-ionic.md).
- Preparar la narrativa comercial para la presentación (a quién le vende,
  qué problema le resuelve, por qué pagaría por la versión premium) — cada
  integrante tiene que poder defenderla en la interrogación oral.
