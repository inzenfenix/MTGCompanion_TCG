# Aplicación de Intercambio de Cartas Mágicas (Frontend Ionic)

Esta carpeta (`apps/mobile/`) contiene la aplicación móvil/web desarrollada con **Ionic React**, **Vite**, y **Framer Motion**. La aplicación actúa como la interfaz de usuario para el escáner de cartas de Magic The Gathering (MTG), integrando un diseño premium de "Fantasía Oscura/Mágica".

## 🚀 Estado Actual del Proyecto

El frontend ya cuenta con una interfaz sólida, tematizada e interactiva, **conectada al backend real** (`backend/`, NestJS + Prisma + PostgreSQL):

- **Diseño Mágico ("Glassmorphism"):** Uso extensivo de efectos de cristal esmerilado, fondos atmosféricos animados (orbes de luz) y componentes personalizados (como pergaminos y botones mágicos).
- **Temas Dinámicos:** Selector de temas integrado que permite a los usuarios alternar al instante entre **Dark Magic Mode** (magia de sangre oscura) y **Light Magic Mode** (brillo celestial cian/blanco).
- **Internacionalización (i18n):** Traducciones configuradas en tres idiomas: Inglés, Español Latino (es-LA) y Francés.
- **Sesión con login real (JWT):** `src/lib/auth/AuthContext.tsx` — inicia sesión contra `POST /auth/login` (o registra + inicia sesión automáticamente contra `POST /users/register`), persiste `{accessToken, user}` en `localStorage`, y `src/lib/api.ts` manda ese token como `Authorization: Bearer <token>` en cada request. Un 401 (token vencido o inválido — el access token dura `JWT_ACCESS_TTL`, 15 minutos por defecto) cierra la sesión automáticamente. Toda la app consume la sesión vía `useAuth()` — nada llama a `localStorage`/`api.setAuthToken()` directamente fuera de este archivo. Para probar sin registrar una cuenta nueva, usá la cuenta de prueba del seed del backend (`test@example.com` / `password123` — ver `backend/README.md`).
- **Cliente de API real:** `src/lib/api.ts` — cliente `fetch` tipado para todo el surface del backend (usuarios, cartas + fotos, transacciones), leyendo la URL base desde `VITE_API_BASE_URL`.
- **Navegación Interactiva (Tabs):**
  - **The Keep (Tab 1):** Resumen financiero (balance de tesorería — todavía mock, ver "Qué falta" abajo) y un registro de operaciones pasadas.
  - **Trade Nexus (Tab 2):** Flujo de compra/venta entre comerciantes y compradores, **cableado a `POST /transactions` real** (el comerciante elige una carta real de su inventario y puede editar su precio de verdad vía `PATCH /cards`; el comprador ingresa el código de comercio mostrado por el QR — no hay escaneo por cámara todavía, solo generación de QR/código pegable — y la compra crea una transacción real, ver "Qué falta" abajo sobre lo que eso sí y no hace todavía). También tiene **cámara en vivo + Stage 1 (detector MTG/no-MTG) vía `onnxruntime-web`** en el paso de "Identify Artifact" (ver sección de ML abajo).
  - **The Vault (Tab 3):** Galería/inventario de las cartas del usuario, **leídas del backend real** (`GET /cards?ownerId=...`), con miniaturas resueltas vía URLs prefirmadas de sus fotos. Incluye un botón flotante para listar una carta nueva.
  - **Grimoire (Tab 4):** Menú de ajustes del sistema (idiomas, temas, etc.), con el nombre/correo del usuario actual y un logout real (limpia la sesión local).
  - **List a Card:** Formulario nuevo (`src/pages/ListCard.tsx`) para crear una carta (`POST /cards`) y opcionalmente subirle una foto con `@capacitor/camera` (captura de una sola foto), siguiendo el flujo de subida en dos pasos del backend (URL prefirmada → PUT directo a storage → confirmar).

## 🧠 Pipeline de ML del lado del cliente (Stage 1 — scaffold)

Siguiendo la decisión de arquitectura documentada en
[`apps/README.md`](../README.md): la inferencia
corre 100% en el cliente, vía `onnxruntime-web`, no en el backend.

- **Captura en vivo:** `src/lib/camera/useLiveCamera.ts` — hook con
  `navigator.mediaDevices.getUserMedia` + `<video>`/`<canvas>` (usado en
  Tab2, paso "Identify Artifact"). **No** usa
  `@capacitor-community/camera-preview` — esa es una ruta de mejora
  explícitamente diferida.
- **Foto única (listar carta):** `@capacitor/camera` — reservado para el
  flujo de una sola foto en `ListCard.tsx`, no para el escaneo en vivo. Ver
  la nota de arquitectura en `apps/README.md`.
- **Inferencia Stage 1:** `src/lib/ml/stage1Detector.ts` — carga un modelo
  ONNX desde una ruta configurable (`VITE_STAGE1_MODEL_URL`, por defecto
  `/models/stage1-detector.onnx`) y corre el detector binario MTG/no-MTG
  sobre el frame capturado.

**⚠️ No existe ningún modelo `.onnx` entrenado en este repo todavía.** El
script de exportación de PyTorch (`ml/training/pytorch/
09_export_onnx.py`) existe pero no se ha corrido para producir un artefacto
en este repositorio, y TensorFlow todavía no tiene script de exportación.
Por eso `stage1Detector.ts` está escrito para degradar con gracia: si no
hay un archivo en `VITE_STAGE1_MODEL_URL`, la UI muestra "Modelo no
disponible todavía" en vez de fallar. Para conectar un modelo real una vez
esté exportado:

1. Correr el script de exportación del framework que haya ganado Stage 1
   (ver `ml/data-prep/README.md`).
2. Copiar el `.onnx` resultante a
   `apps/mobile/public/models/stage1-detector.onnx` (o apuntar
   `VITE_STAGE1_MODEL_URL` a donde se sirva).
3. Revisar que el preprocesamiento en `stage1Detector.ts` (tamaño de
   imagen, normalización, forma de la salida) coincida con lo que espera
   el modelo exportado — hoy son valores placeholder (224×224,
   normalización estilo ImageNet) hasta verificarlos contra el export real.

**Fuera de alcance de este pase, a propósito:** Stage 2 (OCR/validación de
texto — futuro `tesseract.js`) y Stage 3 (estimador de precio — no existe
ningún endpoint HTTP para esto en ningún lado todavía, ni backend ni
cliente; sigue siendo un script de Python local). Donde la UI necesita un
"precio", usa el `guessedPrice` guardado en la carta al momento de listarla
(ver `CardDetails.tsx`), no una estimación en vivo.

## 🚧 ¿Qué falta por implementar?

- **Modelo ONNX real para Stage 1:** el scaffold de inferencia (cámara +
  `onnxruntime-web`) está construido y funciona, pero no hay ningún
  archivo `.onnx` entrenado en el repo — ver sección de ML arriba.
- **Stage 2 (OCR) y Stage 3 (precio):** no conectados, a propósito — no hay
  endpoint de precio en ningún lado, y OCR es trabajo futuro con
  `tesseract.js`.
- **Escaneo de QR por cámara:** Trade Nexus genera un QR real (con el id de
  la carta) del lado del comerciante, pero el comprador todavía lo ingresa
  a mano (pegando el código) — no hay librería de decodificación de QR por
  cámara en el proyecto todavía.
- **Flujo de Pagos Real:** `POST /transactions` ya está cableado desde
  Trade Nexus (ver arriba) y crea un registro real, pero el backend solo
  tiene un stub (`NoopPaymentProvider`) que no cobra nada de verdad — toda
  transacción queda en estado `PENDING` para siempre. Falta conectar el
  webhook oficial de **WebPay / Mercado Pago** (el backend ya deja un slot,
  `PaymentProvider`, listo para esto).
- **Transferencia de propiedad de la carta:** al crear una transacción,
  `card.ownerId` no cambia — una "compra" hoy registra un pago pero la
  carta no se mueve al Vault del comprador. Es una decisión de backend
  pendiente (¿al crear la transacción, o solo cuando un proveedor de pago
  real confirme `COMPLETED`? — ligado al punto anterior), no algo que este
  frontend pueda decidir por su cuenta.
- **Balance de tesorería (Tab 1):** sigue siendo un mock (`$1,250.00`) — el
  backend deliberadamente no modela un campo `balance` en `User` todavía
  (ver "Qué falta" en `backend/README.md`); se deriva de transacciones
  reales una vez exista integración de pagos real.
- **Scraping / Geolocalización:** Herramientas para buscar y localizar
  mediante scraping tiendas físicas cercanas u otros usuarios que tengan
  las cartas deseadas (Tab Bazaar sigue con datos de ejemplo).
- **Estado Global:** La sesión ya vive en `AuthContext`; el resto de
  estado sigue siendo local a cada página. Migrar a algo más centralizado
  (Zustand, Redux) solo si la complejidad lo justifica.

---

## 🛠️ Instrucciones de Despliegue (Entorno de Desarrollo)

Esta app necesita el backend (`backend/`) corriendo para hacer algo más que
mostrar la pantalla de registro. Instrucciones completas para levantar
**todo el stack**:

### 1. Backend (API + servicios de apoyo)

```bash
cd backend
cp .env.example .env      # valores por defecto ya sirven para desarrollo local
npm install
npm run docker:up         # Postgres + MinIO + MailHog vía backend/docker/dev.sh (no hace falta un compose propio para Ionic)
npx prisma migrate dev    # aplica el schema a Postgres (solo la primera vez / cuando cambie)
npm run start:dev         # API en http://localhost:3000
```

Detalle completo (arquitectura, qué hace cada servicio de Docker, cómo
verificar que el correo de bienvenida llega a MailHog) en
[`backend/README.md`](../backend/README.md).

### 2. Frontend Ionic (esta carpeta)

En otra terminal:

```bash
cd trading-app-ionic
cp .env.example .env      # por defecto ya apunta a VITE_API_BASE_URL=http://localhost:3000
npm install
ionic serve
```

*(Si `ionic serve` falla, asegúrate de tener el CLI de Ionic instalado
globalmente: `npm install -g @ionic/cli`. También podés usar `npm run dev`
directamente con Vite.)*

La aplicación se abre en el navegador. La primera pantalla es "Onboarding":
registrate ahí con una cuenta nueva, o iniciá sesión con la cuenta de
prueba del seed del backend (`test@example.com` / `password123` — ver
`backend/README.md`).

3. También podés ver la app con proporciones de teléfono presionando F12 y
   activando el "Device Toolbar" (Modo Móvil) de tu navegador.

### Variables de entorno de esta app

| Variable | Default | Para qué |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:3000` | Base URL del backend NestJS |
| `VITE_STAGE1_MODEL_URL` | `/models/stage1-detector.onnx` | Dónde servir el modelo ONNX de Stage 1 (ver sección de ML arriba) |

Ver `.env.example` en esta carpeta para el detalle comentado.

### CI: compilar el APK sin usar una laptop (ROADMAP.md M2)

`.github/workflows/build-apk.yml` (raíz del repo) arma el APK debug —
`npm ci` → baja los `.onnx` publicados por M1 desde S3 → escribe
`VITE_API_BASE_URL`/`network_security_config.xml` con el `backend_url`
real → los mismos pasos que corre localmente el botón "Reconstruir APK"
de `desktop-runner` (`setup:opencv` → `build` → `cap sync android` →
`gradlew assembleDebug`) → publica el `.apk` como GitHub Release. Se
dispara a mano desde la pestaña Actions (`workflow_dispatch`) — todavía no
hay botón en `desktop-runner` para esto (ROADMAP.md M3, bloqueado en tener
`gh` CLI + un mecanismo para refrescar credenciales AWS que vencen).

Antes de la primera corrida, configurar en GitHub (Settings → Secrets and
variables → Actions), una sola vez:

| Tipo | Nombre | Valor |
|---|---|---|
| Secret | `AWS_ACCESS_KEY_ID` | Credenciales temporales de AWS Academy (las mismas que la pestaña Deploy de `desktop-runner`) |
| Secret | `AWS_SECRET_ACCESS_KEY` | ídem |
| Secret | `AWS_SESSION_TOKEN` | ídem — **vencen**; si una corrida falla en el paso de S3 con un error de auth, son las primeras sospechosas |
| Variable | `AWS_REGION` | `terraform output aws_region` |
| Variable | `DEPLOY_ARTIFACTS_BUCKET` | `terraform output deploy_artifacts_bucket_name` |
| Variable | `BACKEND_URL` | `terraform output backend_url` (se puede pisar por corrida con el input `backend_url` del workflow) |

Debug-signed únicamente por ahora — no hay keystore de release todavía
(ver el punto abierto al final de la asignación de la persona 3 en
ROADMAP.md).
