# Cifrado de Datos Personales — Revisión por campo sensible

**Nombre:** _[completar]_
**Integrantes:** _[completar]_
**Fecha de revisión:** 25 sep 2026
**Alcance:** MTG Companion (`Proyecto/examen/`) — `backend/` (NestJS + Prisma + PostgreSQL), `trading-app-ionic/` (cliente), `infra/terraform/` (AWS), `desktop-runner/` (herramienta interna).
**Insumo:** [`MAPEO_CIA.md`](MAPEO_CIA.md) (diccionario de actores/datos/riesgos) + revisión directa del código.

> Este documento es **solo revisión y decisión** (primera mitad del entregable). La implementación de lo que falta está registrada como tarea en `ROADMAP.md`, **workstream O**, y no se ha ejecutado todavía.

---

## 1. Criterio de decisión

Se siguió la pregunta guía de la actividad — **¿el sistema necesita recuperar el dato original?** — y la cadena *dato → necesidad → técnica → herramienta → gestión de llaves → evidencia*:

| Si el sistema necesita… | Técnica | Ejemplo en este proyecto |
|---|---|---|
| Solo **comparar/verificar** el dato | **Hashing** (bcrypt / SHA-256) | Contraseña, refresh token |
| **Recuperar** el dato original | **Cifrado simétrico** (AES-256-GCM) | Secreto TOTP, ubicación, correo |
| **No tocar nunca** el dato, solo referenciarlo | **Tokenización** (token + bóveda) | Tarjeta de pago → MercadoPago |
| Garantizar que un dato **no fue alterado** / quién lo emitió | **Firma / MAC** (HMAC-SHA256) | JWT, QR de compraventa, webhook de pago |
| Proteger el dato **mientras viaja** | **TLS (híbrido asimétrico + simétrico)** | Toda comunicación app ↔ backend |

Principio transversal: **no se inventa criptografía** — solo primitivas estándar vía librerías reconocidas (`node:crypto`, `bcryptjs`, `@nestjs/jwt`, SDK oficial de MercadoPago, cifrado administrado de AWS).

---

## 2. Tabla por campo sensible

Estado: ✅ ya implementado · ⚠️ parcial · ❌ pendiente (tarea en `ROADMAP.md` workstream O).

| # | Campo | Técnica elegida | Justificación técnica | Algoritmo / librería | Ubicación donde se protege | Gestión de llaves | Estado |
|---|---|---|---|---|---|---|---|
| 1 | `User.passwordHash` (contraseña) | **Hashing** | Solo se necesita comprobarla en el login, nunca recuperarla. Es un secreto de **baja entropía** elegido por una persona → hash **lento** y con sal para frenar fuerza bruta offline si se filtra la BD (riesgo del MAPEO). | bcrypt, costo 12 — `bcryptjs` | Backend, `UsersService.register()` (`users.service.ts:66`) y `validateCredentials()` (`:102`), antes de persistir | Sin llave. La sal es aleatoria por usuario y va embebida en el hash. El costo (12) es configurable al subir el hardware | ✅ |
| 2 | `RefreshToken.tokenHash` | **Hashing** | Solo se verifica que el token presentado exista. Es un valor aleatorio de **512 bits** (alta entropía): no hay nada que forzar, así que un hash lento no aporta y uno rápido basta. Además es de un solo uso (rota en cada `/auth/refresh`). | SHA-256 — `node:crypto` | Backend, `AuthService.hashToken()` (`auth.service.ts:171`) | Sin llave | ✅ |
| 3 | `UserSettings.twoFactorSecret` (secreto TOTP) | **Cifrado simétrico** | TOTP necesita el **secreto original** para calcular el código de cada 30 s → un hash no sirve. **Hoy está en texto plano**: quien lea la BD puede generar códigos 2FA válidos de cualquier usuario, anulando el segundo factor. | AES-256-GCM — `node:crypto` | Backend, capa de infraestructura: `PrismaUserRepository` cifra al escribir (`prisma-user.repository.ts:45`) y descifra al leer | Llave `FIELD_ENCRYPTION_KEY` (32 bytes) en AWS Secrets Manager (prod) / `.env` gitignoreado (dev). Nunca en la BD ni en el código | ❌ |
| 4 | `UserSettings.lastLat` / `lastLng` (geolocalización) | **Cifrado simétrico** | Es **dato personal** (ubicación de una persona, Ley 21.719). El backend sí necesita el valor original: calcula la distancia con haversine **en Node** (`cards.service.ts:31`), no en SQL → reversible y cifrable sin perder funcionalidad. | AES-256-GCM — `node:crypto` | Backend, mismo repositorio; columna migra de `Float` a `String` (texto cifrado) | Misma llave de campo que #3 | ❌ |
| 5 | `User.email` | **Cifrado simétrico + índice ciego** | Debe **recuperarse** (envío de correos de bienvenida/comprobantes) → cifrado. Pero el login lo **busca por igualdad** y es `@unique` → se agrega un índice ciego (HMAC determinista del email normalizado) para buscar sin descifrar. | AES-256-GCM + HMAC-SHA256 — `node:crypto` | Backend, `UsersService` / repositorio; nueva columna `emailHash @unique` | Dos llaves distintas (cifrado ≠ índice ciego), ambas en Secrets Manager | ❌ (opcional, mayor costo) |
| 6 | Número de tarjeta / datos de pago | **Tokenización** | El sistema **nunca necesita ver** la tarjeta. Con Checkout Pro el usuario paga en MercadoPago (redirección); la app solo guarda la referencia del pago. MercadoPago actúa como **bóveda**; `Transaction.paymentRef` es el **token**: sin acceso a MercadoPago no revela nada. | MercadoPago Checkout Pro — SDK oficial `mercadopago` | Proveedor externo; el backend solo persiste `paymentRef` (`mercadopago-payment.provider.ts:55`) | `MERCADOPAGO_ACCESS_TOKEN` en Secrets Manager, nunca en el cliente | ✅ |
| 7 | Access token de sesión (JWT) | **Firma (MAC)** | No es secreto su contenido (id + email del usuario) sino su **integridad**: nadie debe poder fabricar uno. Se firma y el backend verifica la firma en cada request. Tokens de otro tipo (`typ: '2fa'`, `typ: 'listing'`) se rechazan como sesión (`jwt.strategy.ts:33`). | HS256 (HMAC-SHA256) — `@nestjs/jwt` | Backend, `AuthService.signAccessToken()` / `JwtStrategy` | `JWT_SECRET` en Secrets Manager. ⚠️ `configuration.ts:74` cae a `'change-me-dev-only'` si falta → en producción debe negarse a arrancar | ⚠️ |
| 8 | Token del QR de compraventa (código de verificación) | **Firma (MAC)** | El comprador debe confiar en que el QR apunta a una publicación real y no a un id de carta arbitrario. Firmado y con vida corta (3 min) para que un QR olvidado sobre la mesa caduque. | HS256 — `@nestjs/jwt`, `typ: 'listing'` | Backend, `cards/domain/listing-token.ts` | Mismo `JWT_SECRET` (ver #7) | ✅ |
| 9 | Notificación de pago confirmado (webhook) | **Firma (MAC)** | Se debe verificar que la notificación viene de MercadoPago y no fue forjada por un tercero. Además el backend re-consulta el pago a la API en vez de confiar en el cuerpo del webhook. | HMAC-SHA256 sobre cabecera `x-signature` — SDK `mercadopago` | Backend, `MercadoPagoPaymentProvider` (`mercadopago-payment.provider.ts:101`) | `MERCADOPAGO_WEBHOOK_SECRET` en Secrets Manager | ✅ |
| 10 | Credenciales de login, código 2FA, secreto TOTP en el setup, tokens de sesión — **en tránsito** | **TLS (híbrido)** | Todo esto viaja entre app y backend. Hoy el cliente apunta a `http://<ip-ec2>:3000` (**HTTP plano**): la respuesta de `POST /auth/2fa/setup` incluye el secreto TOTP en claro, por lo que cifrarlo en BD (#3) no sirve de nada sin TLS. TLS usa asimetría para acordar la llave de sesión y AES para el tráfico. | TLS 1.2/1.3 — reverse proxy Caddy + certificado Let's Encrypt (hostname nip.io/sslip.io) | EC2 del backend, delante de NestJS (`:443` → `:3000`) | Certificado y llave privada TLS los gestiona y renueva Caddy automáticamente, dentro de la instancia | ❌ (ROADMAP I6, a medias) |
| 11 | Conexión backend ↔ PostgreSQL | **TLS** | Tráfico interno de VPC entre dos EC2, ya restringido con reglas security-group-a-security-group. Riesgo menor que #10; mejora de defensa en profundidad. | TLS de PostgreSQL — `sslmode=require` en `DATABASE_URL` | `deploy-backend.sh` / config de Postgres | Certificado del servidor Postgres | ❌ (prioridad baja) |
| 12 | Fotos subidas por los usuarios (`CardPhoto` → S3) | **Cifrado en reposo (administrado)** + acceso privado | Las fotos deben servirse de vuelta (reversible) y son archivos grandes → cifrado simétrico del lado del almacenamiento. Bucket privado, bloqueo de acceso público y URLs prefirmadas de vida corta (5 min subida / 1 h descarga). | SSE-S3 (AES-256, por defecto en S3 desde 2023) | AWS S3 (`s3.tf:34`), `StorageService` (`storage.service.ts:82`) | Llaves administradas por AWS. Recomendado: declarar `server_side_encryption_configuration` explícito en Terraform como evidencia | ⚠️ |
| 13 | Base de datos completa (cuentas, colección/inventario, transacciones, montos, cupones) | **Cifrado en reposo (disco)** | Estos datos deben **consultarse, ordenarse y agregarse en SQL** (ej. ofertas ordenadas por fecha/monto en subastas, filtros de búsqueda) → cifrarlos campo a campo rompería la funcionalidad. Se protegen a nivel de volumen + control de acceso (RBAC, próxima sesión). Hoy el volumen EBS de la EC2 de Postgres **no está cifrado**. | Cifrado EBS (AES-256 vía AWS KMS, llave `aws/ebs`) | `infra/terraform/ec2_postgres.tf` → `root_block_device { encrypted = true }` | Llave administrada por KMS. Activarlo **recrea la instancia** (pérdida de datos en el lab) | ❌ |
| 14 | Secretos de configuración (`JWT_SECRET`, tokens MercadoPago, password Postgres, MinIO) | **Gestión de secretos** (no se cifran en el código: se sacan del código) | Son las llaves que protegen todo lo anterior. Regla del curso: nunca en el código, nunca junto al dato. | AWS Secrets Manager; leídos al arrancar con el rol de la instancia | `infra/terraform/secrets.tf`, `deploy-backend.sh:79` | `.env`, `terraform.tfvars` y `*.tfstate` gitignoreados — verificado que nunca se commitearon. El `tfstate` local contiene los secretos en claro (propio de Terraform) → no debe salir de la máquina | ✅ |
| 15 | Credenciales AWS del administrador (desktop-runner) | **Cifrado simétrico con llavero del SO** | Deben recuperarse (se pasan a `terraform`/`aws`) → reversible. Hoy se guardan fuera del repo (`~/.mtg-desktop-runner/settings.json`) pero **en texto plano con permisos 0644**. | Electron `safeStorage` (usa libsecret / Keychain / DPAPI) o, mínimo, permisos `0600` | `desktop-runner/apps/server/src/scripts/settings.ts:101` | La llave la custodia el llavero del sistema operativo, no la app | ⚠️ |
| 16 | Sesión en el cliente (access + refresh token) | **Almacenamiento seguro del dispositivo** | Se guardan en `localStorage` (`AuthContext.tsx:53`): cualquier XSS los puede leer (riesgo del MAPEO). En Android conviene el almacén protegido por hardware. | Android Keystore vía plugin de almacenamiento seguro de Capacitor | `trading-app-ionic/src/lib/auth/AuthContext.tsx` | Llave del Keystore del dispositivo, no exportable | ❌ (prioridad baja) |

### Datos revisados que **no** requieren cifrado de campo (justificación)

| Dato | Por qué no |
|---|---|
| `User.displayName` | Se muestra públicamente a la contraparte de una compraventa; cifrarlo no aporta confidencialidad. Cubierto por #10 y #13. |
| `CatalogCard` (catálogo Scryfall) | Datos públicos de terceros, sin información personal. |
| `Card` (título, condición, precio estimado, rareza) | Es el contenido de una publicación de venta, pensado para ser visto. Su riesgo en el MAPEO es de **integridad** (precio alterado por el cliente), no de confidencialidad → se resuelve con validación del lado servidor, no con cifrado. |
| `Coupon` (descuento, vencimiento) | Riesgo de **integridad** (autoasignarse premios), ya mitigado: se emite y canjea solo en backend. |
| `UserSettings.language/theme/notifyByEmail` | Preferencias sin sensibilidad. |
| Fotos de la cámara en el dispositivo | La inferencia es 100% local (ONNX en el dispositivo) y no se suben salvo que el usuario publique; al subirse aplica #12. |

---

## 3. Diseño propuesto para el cifrado de campos (#3, #4, #5)

Aún **no implementado** — especificación para la tarea del ROADMAP.

- **Algoritmo:** AES-256-GCM. Se elige GCM porque es **cifrado autenticado**: además de ocultar el dato, detecta si el texto cifrado fue alterado (el descifrado falla con el tag incorrecto). Se descartan 3DES (legado, según el material) y AES-CBC sin MAC.
- **Librería:** `node:crypto` (incluida en Node, sin dependencias nuevas).
- **Formato almacenado:** `v1:<iv base64>:<tag base64>:<ciphertext base64>` — IV aleatorio de 12 bytes **por cada escritura** (nunca se reutiliza), y prefijo de versión de llave para permitir **rotación** (se descifra con la versión indicada, se re-cifra con la vigente).
- **Dónde:** un único servicio `backend/src/common/crypto/field-encryption.service.ts`, usado solo desde la capa de infraestructura (repositorios Prisma). Dominio y controladores siguen viendo texto plano; la BD solo ve texto cifrado.
- **Índice ciego (#5):** `emailHash = HMAC-SHA256(llave_índice, lower(trim(email)))`, con `@unique`. Llave distinta a la de cifrado para que comprometer una no comprometa la otra.

### Cómo se recupera o valida cada dato

| Técnica | Cómo se usa el dato después |
|---|---|
| Hash (contraseña) | `bcrypt.compare(ingresada, hash)` — se **valida**, nunca se recupera. |
| Hash (refresh token) | Se hashea el token presentado y se busca por `tokenHash`; se borra y se emite uno nuevo. |
| AES-GCM (TOTP, ubicación, email) | El repositorio descifra con la llave en memoria justo antes de calcular el código TOTP / la distancia / enviar el correo. |
| Índice ciego (email) | En el login se calcula el HMAC del email ingresado y se busca por `emailHash`, sin descifrar ninguna fila. |
| Tokenización (pago) | Se consulta a MercadoPago por `paymentRef` (`Payment.get()`); el dato de tarjeta nunca vuelve al sistema. |
| Firma (JWT / QR / webhook) | Se **valida** la firma con el secreto; si no calza, 401. |

### Gestión de llaves (aplicado a las recomendaciones del curso)

| Recomendación | Cómo se cumple |
|---|---|
| Nunca junto al dato | La llave vive en la EC2 del **backend** (en memoria, leída desde Secrets Manager al arrancar); los datos viven en la EC2 de **Postgres**, otra instancia. Un volcado de la BD no incluye la llave. |
| Nunca en el código | Variables de entorno → Secrets Manager en prod, `.env` gitignoreado en dev. Además: el backend debe **negarse a arrancar** en producción si falta una llave (hoy `JWT_SECRET` tiene fallback hardcodeado — a corregir). |
| Rotación | Prefijo de versión en el texto cifrado + keyring (`v1`, `v2`…); script de re-cifrado. `JWT_SECRET` se rota invalidando sesiones (el refresh token obliga a re-login). |
| Separación | Llave de cifrado ≠ llave de índice ciego ≠ secreto JWT ≠ secretos de pago. |
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

1. **❌ Sin TLS en producción** (#10) — lo más grave: expone contraseñas, tokens y el secreto TOTP en la red.
2. **❌ Secreto TOTP en texto plano** (#3).
3. **⚠️ Fallback hardcodeado de `JWT_SECRET`** (#7).
4. **❌ Ubicación en texto plano** (#4).
5. **❌ Volumen EBS de Postgres sin cifrar** (#13) · **⚠️ SSE de S3 no declarado explícito** (#12).
6. Mejoras: email cifrado + índice ciego (#5), `safeStorage` en desktop-runner (#15), almacenamiento seguro en el cliente (#16), TLS a Postgres (#11).
