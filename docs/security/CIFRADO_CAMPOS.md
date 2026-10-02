# Cifrado de Datos Personales — Revisión por campo sensible

**Nombre:** _[completar]_
**Integrantes:** _[completar]_
**Fecha de revisión:** 25 sep 2026
**Alcance:** MTG Companion (`apps/`) — `backend/` (NestJS + Prisma + PostgreSQL), `apps/mobile/` (cliente), `infra/terraform/` (AWS), `desktop-runner/` (herramienta interna).
**Insumo:** [`MAPEO_CIA.md`](MAPEO_CIA.md) (diccionario de actores/datos/riesgos) + revisión directa del código.

> Este documento es **solo revisión y decisión** (primera mitad del entregable). La implementación de lo que falta está registrada como tarea en `ROADMAP.md`, **workstream O**, y no se ha ejecutado todavía.

---

## 1. Criterio de decisión

Se siguió la pregunta guía de la actividad — **¿el sistema necesita recuperar el dato original?** — y la cadena *dato → necesidad → técnica → herramienta → gestión de llaves → evidencia*:

| Si el sistema necesita… | Técnica | Ejemplo en este proyecto |
|---|---|---|
| Solo **comparar/verificar** el dato | **Hashing** (bcrypt / SHA-256) | Contraseña, refresh token |
| **Recuperar** el dato original | **Cifrado simétrico** (AES-256-GCM) | Secreto TOTP, ubicación |
| **No tocar nunca** el dato, solo referenciarlo | **Tokenización** (token + bóveda) | Tarjeta de pago → MercadoPago |
| Garantizar que un dato **no fue alterado** / quién lo emitió | **Firma y verificación** (HMAC-SHA256) | JWT, QR de compraventa, webhook de pago |
| Proteger el dato **mientras viaja** | **TLS (híbrido asimétrico + simétrico)** | Toda comunicación app ↔ backend |

Principio transversal: **no se inventa criptografía** — solo primitivas estándar vía librerías reconocidas (`node:crypto`, `bcryptjs`, `@nestjs/jwt`, SDK oficial de MercadoPago, cifrado administrado de AWS).

---

## 2. Tabla por campo sensible

Estado: ✅ ya implementado · ⚠️ parcial · ❌ pendiente (tarea en `ROADMAP.md` workstream O).

| # | Campo | Técnica elegida | Justificación técnica | Algoritmo / librería | Ubicación donde se protege | Gestión de llaves | Estado |
|---|---|---|---|---|---|---|---|
| 1 | `User.passwordHash` (contraseña) | **Hashing** | Solo se compara en el login, nunca se recupera. Es de **baja entropía** → hash lento con sal contra fuerza bruta. | bcrypt, costo 12 — `bcryptjs` | Backend, `UsersService.register()` (`users.service.ts:66`) y `validateCredentials()` (`:102`), antes de persistir | Sin llave. Sal aleatoria por usuario, embebida en el hash; costo (12) ajustable. | ✅ |
| 2 | `RefreshToken.tokenHash` | **Hashing** | Solo se verifica que exista. Es aleatorio de **512 bits** y de un solo uso → basta un hash rápido. | SHA-256 — `node:crypto` | Backend, `AuthService.hashToken()` (`auth.service.ts:171`) | Sin llave; el token ya es aleatorio y de un solo uso. | ✅ |
| 3 | `UserSettings.twoFactorSecret` (secreto TOTP) | **Cifrado simétrico** | TOTP necesita el **secreto original** para generar códigos → no sirve hash. **Hoy está en texto plano**. | AES-256-GCM — `node:crypto` | Backend, capa de infraestructura: `PrismaUserRepository` cifra al escribir (`prisma-user.repository.ts:45`) y descifra al leer | `FIELD_ENCRYPTION_KEY` (32 bytes) en AWS Secrets Manager (prod) / `.env` gitignoreado (dev). Nunca en la BD ni en el código. | ❌ |
| 4 | `UserSettings.lastLat` / `lastLng` (geolocalización) | **Cifrado simétrico** | Ubicación = **dato personal** (Ley 21.719). La distancia se calcula en Node → se puede descifrar ahí. | AES-256-GCM — `node:crypto` | Backend, mismo repositorio; columna migra de `Float` a `String` (texto cifrado) | Misma llave que #3. | ❌ |
| 5 | Número de tarjeta / datos de pago | **Tokenización** | El sistema **nunca ve** la tarjeta: MercadoPago es la **bóveda** y `paymentRef` el **token**. | MercadoPago Checkout Pro — SDK oficial `mercadopago` | Proveedor externo; el backend solo persiste `paymentRef` (`mercadopago-payment.provider.ts:55`) | `MERCADOPAGO_ACCESS_TOKEN` en Secrets Manager; nunca llega al cliente. | ✅ |
| 6 | Access token de sesión (JWT) | **Firma** | Importa la **integridad**, no el secreto: nadie debe fabricar un token. El backend verifica la firma. | HS256 (HMAC-SHA256) — `@nestjs/jwt` | Backend, `AuthService.signAccessToken()` / `JwtStrategy` | `JWT_SECRET` en Secrets Manager. Riesgo: valor por defecto `'change-me-dev-only'` si falta la variable. | ⚠️ |
| 7 | Token del QR de compraventa (código de verificación) | **Firma** | Garantiza que el QR apunta a una publicación real. Firmado y caduca en 3 minutos. | HS256 — `@nestjs/jwt`, `typ: 'listing'` | Backend, `cards/domain/listing-token.ts` | Mismo `JWT_SECRET` (ver #6). | ✅ |
| 8 | Notificación de pago confirmado (webhook) | **Firma** | Verifica que la notificación viene de MercadoPago; además se re-consulta el pago a la API. | HMAC-SHA256 sobre cabecera `x-signature` — SDK `mercadopago` | Backend, `MercadoPagoPaymentProvider` (`mercadopago-payment.provider.ts:101`) | `MERCADOPAGO_WEBHOOK_SECRET` en Secrets Manager. | ✅ |
| 9 | Credenciales de login, código 2FA, secreto TOTP en el setup, tokens de sesión — **en tránsito** | **TLS (híbrido)** | Hoy viaja por **HTTP plano**, incluido el secreto TOTP del setup. TLS protege todo el tránsito. | TLS 1.2/1.3 — reverse proxy Caddy + certificado Let's Encrypt (hostname nip.io/sslip.io) | EC2 del backend, delante de NestJS (`:443` → `:3000`) | Certificado y llave privada TLS gestionados y renovados automáticamente por Caddy en la instancia. | ❌ (ROADMAP I6, a medias) |
| 10 | Conexión backend ↔ PostgreSQL | **TLS** | Tráfico interno entre EC2, ya restringido por security groups. Defensa en profundidad. | TLS de PostgreSQL — `sslmode=require` en `DATABASE_URL` | `deploy-backend.sh` / config de Postgres | Certificado del servidor PostgreSQL. | ❌ (prioridad baja) |
| 11 | Fotos subidas por los usuarios (`CardPhoto` → S3) | **Cifrado en reposo (administrado)** | Las fotos deben recuperarse y son archivos grandes → cifrado simétrico en el almacenamiento. | SSE-S3 (AES-256, por defecto en S3 desde 2023) | AWS S3 (`s3.tf:34`), `StorageService` (`storage.service.ts:82`) | Llaves administradas por AWS (SSE-S3). | ⚠️ |
| 12 | Base de datos completa (cuentas, colección/inventario, transacciones, montos, cupones) | **Cifrado en reposo (disco)** | Se consultan y ordenan en SQL → cifrar por campo rompería la app. Se cifra el disco (**hoy no**). | Cifrado EBS (AES-256 vía AWS KMS, llave `aws/ebs`) | `infra/terraform/ec2_postgres.tf` → `root_block_device { encrypted = true }` | Llave administrada por AWS KMS (`aws/ebs`). | ❌ |
| 13 | Secretos de configuración (`JWT_SECRET`, tokens MercadoPago, password Postgres, MinIO) | **Gestión de secretos** (no se cifran en el código: se sacan del código) | Son las llaves de todo lo anterior: nunca en el código ni junto al dato. | AWS Secrets Manager; leídos al arrancar con el rol de la instancia | `infra/terraform/secrets.tf`, `deploy-backend.sh:79` | `.env`, `terraform.tfvars` y `*.tfstate` gitignoreados; verificado que nunca se commitearon. | ✅ |
| 14 | Credenciales AWS del administrador (desktop-runner) | **Cifrado simétrico con llavero del SO** | Deben recuperarse para usarse. Hoy están **en texto plano** fuera del repo. | Electron `safeStorage` (usa libsecret / Keychain / DPAPI) o, mínimo, permisos `0600` | `desktop-runner/apps/server/src/scripts/settings.ts:101` | La llave la custodia el llavero del sistema operativo, no la app. | ⚠️ |
| 15 | Sesión en el cliente (access + refresh token) | **Almacenamiento seguro del dispositivo** | En `localStorage` cualquier XSS puede leerlos. En Android conviene el almacén del hardware. | Android Keystore vía plugin de almacenamiento seguro de Capacitor | `apps/mobile/src/lib/auth/AuthContext.tsx` | Llave del Android Keystore, no exportable. | ❌ (prioridad baja) |

### Datos revisados que **no** requieren cifrado de campo (justificación)

| Dato | Por qué no |
|---|---|
| `User.email` | El login lo busca por igualdad y es `@unique`. Cifrarlo con AES-GCM (IV aleatorio) impediría esa búsqueda, y existe principalmente para iniciar sesión y recibir correos. Se protege en tránsito (#9) y en reposo a nivel de disco (#12). |
| `User.displayName` | Se muestra públicamente a la contraparte de una compraventa; cifrarlo no aporta confidencialidad. Cubierto por #9 y #12. |
| `CatalogCard` (catálogo Scryfall) | Datos públicos de terceros, sin información personal. |
| `Card` (título, condición, precio estimado, rareza) | Es el contenido de una publicación de venta, pensado para ser visto. Su riesgo en el MAPEO es de **integridad** (precio alterado por el cliente), no de confidencialidad → se resuelve con validación del lado servidor, no con cifrado. |
| `Coupon` (descuento, vencimiento) | Riesgo de **integridad** (autoasignarse premios), ya mitigado: se emite y canjea solo en backend. |
| `UserSettings.language/theme/notifyByEmail` | Preferencias sin sensibilidad. |
| Fotos de la cámara en el dispositivo | La inferencia es 100% local (ONNX en el dispositivo) y no se suben salvo que el usuario publique; al subirse aplica #11. |

---

## 3. Diseño propuesto para el cifrado de campos (#3, #4)

Aún **no implementado** — especificación para la tarea del ROADMAP.

- **Algoritmo:** AES-256-GCM. Se elige GCM porque es **cifrado autenticado**: además de ocultar el dato, detecta si el texto cifrado fue alterado (el descifrado falla con el tag incorrecto). Se descartan 3DES (legado, según el material) y AES-CBC sin MAC.
- **Librería:** `node:crypto` (incluida en Node, sin dependencias nuevas).
- **Formato almacenado:** `v1:<iv base64>:<tag base64>:<ciphertext base64>` — IV aleatorio de 12 bytes **por cada escritura** (nunca se reutiliza), y prefijo de versión de llave para permitir **rotación** (se descifra con la versión indicada, se re-cifra con la vigente).
- **Dónde:** un único servicio `backend/src/common/crypto/field-encryption.service.ts`, usado solo desde la capa de infraestructura (repositorios Prisma). Dominio y controladores siguen viendo texto plano; la BD solo ve texto cifrado.

### Cómo se recupera o valida cada dato

| Técnica | Cómo se usa el dato después |
|---|---|
| Hash (contraseña) | `bcrypt.compare(ingresada, hash)` — se **valida**, nunca se recupera. |
| Hash (refresh token) | Se hashea el token presentado y se busca por `tokenHash`; se borra y se emite uno nuevo. |
| AES-GCM (TOTP, ubicación) | El repositorio descifra con la llave en memoria justo antes de calcular el código TOTP / la distancia. |
| Tokenización (pago) | Se consulta a MercadoPago por `paymentRef` (`Payment.get()`); el dato de tarjeta nunca vuelve al sistema. |
| Firma (JWT / QR / webhook) | Se **valida** la firma con el secreto; si no calza, 401. |

### Gestión de llaves (aplicado a las recomendaciones del curso)

| Recomendación | Cómo se cumple |
|---|---|
| Nunca junto al dato | La llave vive en la EC2 del **backend** (en memoria, leída desde Secrets Manager al arrancar); los datos viven en la EC2 de **Postgres**, otra instancia. Un volcado de la BD no incluye la llave. |
| Nunca en el código | Variables de entorno → Secrets Manager en prod, `.env` gitignoreado en dev. Además: el backend debe **negarse a arrancar** en producción si falta una llave (hoy `JWT_SECRET` tiene fallback hardcodeado — a corregir). |
| Rotación | Prefijo de versión en el texto cifrado + keyring (`v1`, `v2`…); script de re-cifrado. `JWT_SECRET` se rota invalidando sesiones (el refresh token obliga a re-login). |
| Separación | Llave de cifrado de campos ≠ secreto JWT ≠ secretos de pago. |
| Acceso mínimo | Solo el rol de instancia del backend lee sus secretos en Secrets Manager; Postgres no tiene acceso a ellos. |
| Auditoría | Lecturas de Secrets Manager quedan registradas en CloudTrail (si el Learner Lab lo permite). |

---

## 4. Evidencia a producir en la implementación

Pendiente, junto con la tarea del ROADMAP:

1. **Código fuente:** `field-encryption.service.ts` + su uso en `PrismaUserRepository` + migración Prisma + script de migración de filas existentes.
2. **Pruebas unitarias:** ida y vuelta cifrar/descifrar; texto cifrado alterado → error; llave incorrecta → error; dos cifrados del mismo valor → textos distintos (IV aleatorio).
3. **Evidencia en BD:** `SELECT two_factor_secret, last_lat FROM user_settings` mostrando `v1:…` en vez de texto plano.
4. **Evidencia funcional:** flujo 2FA completo por `curl` (setup → enable → login → verify) funcionando con el secreto cifrado.
5. **Llaves no expuestas:** `git log -p` / `gitleaks detect` sobre el historial sin hallazgos; `.gitignore` cubriendo `.env`, `*.tfstate`, `terraform.tfvars`; backend que falla al arrancar sin llave en `NODE_ENV=production`.
6. **Tránsito:** `curl -v https://…` mostrando el handshake TLS y el certificado válido.

---

## 5. Resumen de brechas (por prioridad)

1. **❌ Sin TLS en producción** (#9) — lo más grave: expone contraseñas, tokens y el secreto TOTP en la red.
2. **❌ Secreto TOTP en texto plano** (#3).
3. **⚠️ Fallback hardcodeado de `JWT_SECRET`** (#6).
4. **❌ Ubicación en texto plano** (#4).
5. **❌ Volumen EBS de Postgres sin cifrar** (#12) · **⚠️ SSE de S3 no declarado explícito** (#11).
6. Mejoras: `safeStorage` en desktop-runner (#14), almacenamiento seguro en el cliente (#15), TLS a Postgres (#10).
