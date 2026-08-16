# MTG Companion — Backend (NestJS + Prisma + PostgreSQL)

Esta carpeta (`backend/`) contiene la API que le da persistencia real a
**MTG Companion**, la app comercial planteada para el Examen (ver
[Proyecto/examen/README.md](../README.md)): cuentas de
usuario, cartas de la colección con sus fotos, transacciones de
compra/venta entre usuarios, y el settings de cada cuenta (idioma, tema,
2FA a futuro). El escaneo/identificación de la carta en sí sigue corriendo
del lado del cliente en `trading-app-ionic/` vía `onnxruntime-web` — este
backend no hace inferencia, solo guarda lo que el usuario colecciona y
transacciona.

## 🚀 Estado actual

- ✅ Registro de usuario + email de bienvenida (SMTP/MailHog en dev, SES
  como seam para prod — ver "Sobre el email" más abajo).
- ✅ CRUD de cartas + subida de fotos a object storage (S3-compatible) vía
  URLs prefirmadas.
- ✅ Transacciones entre comprador y vendedor, con dos métodos de pago
  seleccionables por transacción (`Transaction.paymentMethod`): **MercadoPago**
  (Checkout Pro real vía el SDK oficial — `MercadoPagoProvider`, preference +
  webhook con verificación de firma, `POST /payments/webhook`) o **Efectivo**
  (`CashPaymentProvider` — sin rail externo, marca `PAID` de inmediato, la vía
  rápida sin credenciales para pruebas/demos). `MERCADOPAGO_ACCESS_TOKEN` sin
  configurar (el caso por defecto en este repo) sigue cayendo a
  `NoopPaymentProvider` como antes — cero cambio de comportamiento sin
  credenciales reales. `PAYMENT_PROVIDERS` (`payments.module.ts`) reemplazó al
  antiguo slot único `PAYMENT_PROVIDER`. `GET /transactions/:id/receipt`
  (solo si `status === 'PAID'`) devuelve el desglose de IVA 19% (neto/IVA/total)
  — un comprobante interno, no una boleta electrónica autorizada por el SII.
- ✅ Login con JWT (`POST /auth/login`) — `POST/PATCH/DELETE /cards`, los
  endpoints de fotos y `POST /transactions` requieren
  `Authorization: Bearer <token>` y el dueño/comprador se toma del token,
  nunca del body (con chequeo de ownership: editar/borrar una carta ajena
  da 404, no 403 — no confirma que el id exista). `GET` sigue público.
- ✅ Refresh tokens (`POST /auth/refresh`) — `POST /auth/login` ahora
  también devuelve un `refreshToken` opaco (512 bits aleatorios, no un JWT)
  además del `accessToken`; su hash SHA-256 se guarda en la tabla
  `refresh_tokens` (`JWT_REFRESH_TTL`, default 30 días). `POST
  /auth/refresh` intercambia un refresh token vigente por un access token +
  refresh token nuevos, **rotando** el que se presentó (se borra al usarlo,
  válido una sola vez) — reusar uno viejo devuelve 401 en vez de funcionar
  en silencio. Todavía no hay endpoint de logout/revocación explícita (la
  tabla `refresh_tokens` ya tiene el índice por `userId` que un futuro
  "cerrar sesión en todos los dispositivos" necesitaría, pero el método de
  repositorio para borrarlos en bloque no está escrito — no se agregó
  código sin un caller real todavía) ni el frontend consume este endpoint
  todavía (`AuthContext.tsx` sigue
  cerrando sesión en cualquier 401 del access token, sin intentar
  refrescar primero — ver `trading-app-ionic/README.md`).
- 🚧 Sin 2FA todavía — deliberadamente fuera de este pase (ver "Qué
  falta").

## 🏗️ Arquitectura

Cada módulo de dominio (`users/`, `cards/`, `transactions/`, y desde los
refresh tokens también `auth/`) sigue la misma separación en capas, para que
cambiar de ORM, agregar tests con mocks, o mover un caso de uso no obligue a
tocar el resto. `auth/` no tiene una entidad "de negocio" propia como
`Card`/`Transaction` — sigue orquestando `UsersService` para todo lo
relacionado a `User` — pero sí tiene su propia entidad de infraestructura
(`RefreshToken`, con su `domain/`/`infrastructure/` igual que los demás
módulos) desde que dejó de ser un simple wrapper de `@nestjs/jwt`:

```
<módulo>/
  domain/            interfaces (puertos): qué necesita el caso de uso,
                      sin saber cómo se persiste (p.ej. CardRepository)
  infrastructure/     la única implementación hoy: adaptador Prisma
                      (p.ej. PrismaCardRepository)
  application/        el caso de uso (p.ej. CardsService) — inyecta el
                      puerto por token DI, nunca Prisma directamente
  presentation/        controller + DTOs (class-validator)
  <módulo>.module.ts   wiring: decide qué implementación va detrás de cada
                        puerto
```

`notifications/`, `payments/` y `storage/` son infraestructura transversal
(no tienen entidad propia de dominio) y siguen el mismo espíritu con un
patrón más simple: una interfaz (`EmailProvider`, `PaymentProvider`) y sus
implementaciones intercambiables por variable de entorno o DI token —
`storage/` solo tiene una implementación porque MinIO habla el mismo API
que S3, así que no hace falta una clase por entorno. `payments/` va un paso
más allá: en vez de un único slot intercambiable, `PAYMENT_PROVIDERS`
inyecta un `Record<PaymentMethod, PaymentProvider>` completo, porque acá
"cuál implementación" no es una decisión de entorno sino algo que el
comprador elige por transacción (MercadoPago vs. Efectivo).

## 🛠️ Instrucciones de despliegue (entorno de desarrollo)

El backend **no corre dentro de Docker** — Docker solo levanta los
servicios de apoyo (Postgres, MinIO, MailHog); el backend se arranca a mano
con `npm run start:dev`.

1. **Variables de entorno:**
   ```bash
   cp .env.example .env
   ```
   Los valores por defecto ya apuntan a los contenedores de abajo, no hace
   falta tocarlos para desarrollo local.

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Levantar Postgres + MinIO + MailHog:**
   ```bash
   npm run docker:up      # equivalente a docker/dev.sh up
   ```
   - Postgres: `localhost:5432`
   - MinIO (S3 API / consola): `localhost:9000` / `localhost:9001`
   - MailHog (SMTP / bandeja web): `localhost:1025` / `localhost:8025`

   `npm run docker:down` los apaga. `npm run docker:logs` sigue sus logs.

4. **Aplicar el schema a la base de datos** (solo hace falta una vez, o
   cada vez que cambie `prisma/schema.prisma`):
   ```bash
   npx prisma migrate dev
   ```

5. **Cargar datos de prueba** (opcional, pero recomendado — sin esto la app
   arranca con la base vacía):
   ```bash
   npm run db:seed
   ```
   Crea dos cuentas con contraseña conocida y algunas cartas reales de
   ejemplo (sin foto a propósito, para poder probar el flujo de "agregar
   foto" de la página de edición):
   - `test@example.com` / `password123` — dueña de las cartas de ejemplo.
   - `buyer@example.com` / `password123` — compradora en una transacción de
     ejemplo contra la anterior.

   Reintentarlo no rompe nada (los usuarios se hacen upsert por email), pero
   sí duplica las cartas/transacciones de ejemplo — para arrancar de cero,
   `npx prisma migrate reset` (borra todo y vuelve a correr migraciones +
   seed) y listo.

6. **Arrancar la API:**
   ```bash
   npm run start:dev
   ```
   Queda escuchando en `http://localhost:3000`.

7. **Probar el login con la cuenta de prueba:**
   ```bash
   curl -X POST http://localhost:3000/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"test@example.com","password":"password123"}'
   ```
   Devuelve un `accessToken` — mandalo como `Authorization: Bearer <token>`
   en `POST/PATCH/DELETE /cards`, los endpoints de fotos, y
   `POST /transactions` (todos requieren sesión; `GET` sigue público, para
   poder navegar el catálogo sin iniciar sesión).

8. **Probar que el registro manda el correo de bienvenida:**
   ```bash
   curl -X POST http://localhost:3000/users/register \
     -H 'Content-Type: application/json' \
     -d '{"email":"tu@ejemplo.com","password":"password123","displayName":"Tu Nombre"}'
   ```
   El correo "queda atrapado" en MailHog — revísalo en
   `http://localhost:8025`, nunca sale a internet.

## Sobre el email: SMTP (MailHog) vs. SES

`EMAIL_PROVIDER=smtp` (el default) manda todo a MailHog — es lo que hay que
usar para la presentación y para cualquier corrida local. `EMAIL_PROVIDER=ses`
existe como seam para un despliegue real con credenciales de AWS propias,
pero **no funciona con las credenciales de un laboratorio de AWS Academy**:
esas cuentas son temporales, con permisos IAM acotados y sin acceso de envío
de SES habilitado, así que no vale la pena perseguirlo para este curso —
MailHog cubre exactamente lo que se necesita demostrar (que el evento se
dispara y el correo se genera con el contenido correcto).

## Qué falta (a propósito, fuera de alcance de este pase)

- **2FA real.** El schema ya tiene `twoFactorEnabled`/`twoFactorSecret` en
  `UserSettings`, pero sin lógica detrás. El método elegido para cuando se
  implemente es **TOTP** (app autenticadora), no OTP por correo.
- **Probar un pago MercadoPago real de punta a punta.** El código es real
  (SDK oficial, `WebhookSignatureValidator` para la firma, `Payment.get()`
  re-consultado en vez de confiar en el body del webhook), pero este repo no
  tiene un `MERCADOPAGO_ACCESS_TOKEN`/`MERCADOPAGO_WEBHOOK_SECRET` de sandbox
  — solo se pudo verificar en vivo la caída a `NoopPaymentProvider` cuando no
  hay token configurado (el caso de hoy). `PUBLIC_API_URL` (nuevo, ver
  `.env.example`) tampoco es útil en `localhost` sin un túnel (ngrok o
  similar) — MercadoPago no puede llamar de vuelta a `notification_url` si
  no es una URL pública.
- **Balance/wallet del usuario.** El mock de `trading-app-ionic/` (Tab 1)
  muestra un balance de tesorería fijo; deliberadamente no se modeló un
  campo `balance` en `User` — ahora que el pago real existe (ver "Estado
  actual"), se puede derivar de las transacciones `PAID`, pero sigue sin
  construirse (ROADMAP.md F5/E7).
- **Export ONNX de Stage 4 (grader de condición) y Stage 1** — vive en
  `Proyecto/certamen_2/`, no en este backend; ver
  [Proyecto/examen/README.md](../README.md).

## Despliegue en producción (EC2, referencia)

Este backend está pensado para correr directo en una instancia EC2 (no en
Docker) apuntando a:
- Postgres real (RDS o el mismo EC2) vía `DATABASE_URL`.
- AWS S3 real vía las mismas variables `STORAGE_*` — basta con borrar
  `STORAGE_ENDPOINT`/`STORAGE_FORCE_PATH_STYLE` y usar credenciales de S3
  reales; el código (`StorageService`) no cambia porque MinIO habla el
  mismo API.
- `EMAIL_PROVIDER=ses` con credenciales de SES reales (fuera del contexto
  de AWS Academy).
