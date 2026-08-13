# MTG Companion — Backend (NestJS + Prisma + PostgreSQL)

Esta carpeta (`backend/`) contiene la API que le da persistencia real a
**MTG Companion**, la app comercial planteada para el Examen (ver
[Proyecto/examen/README.md](../Proyecto/examen/README.md)): cuentas de
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
- ✅ Transacciones entre comprador y vendedor, con un slot de
  `PaymentProvider` listo para MercadoPago (hoy solo hay un
  `NoopPaymentProvider` que deja todo en `PENDING`).
- 🚧 Sin login/JWT/2FA todavía — deliberadamente fuera de este pase (ver
  "Qué falta").

## 🏗️ Arquitectura

Cada módulo de dominio (`users/`, `cards/`, `transactions/`) sigue la misma
separación en capas, para que cambiar de ORM, agregar tests con mocks, o
mover un caso de uso no obligue a tocar el resto:

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
que S3, así que no hace falta una clase por entorno.

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

5. **Arrancar la API:**
   ```bash
   npm run start:dev
   ```
   Queda escuchando en `http://localhost:3000`.

6. **Probar que registra un usuario y manda el correo de bienvenida:**
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

- **Login / JWT / refresh tokens.** Hoy solo existe `POST /users/register`;
  no hay sesión ni endpoints protegidos. Las variables `JWT_*` ya están
  reservadas en `.env.example` para cuando se implemente.
- **2FA real.** El schema ya tiene `twoFactorEnabled`/`twoFactorSecret` en
  `UserSettings`, pero sin lógica detrás. El método elegido para cuando se
  implemente es **TOTP** (app autenticadora), no OTP por correo.
- **MercadoPago real.** `PaymentsModule` solo tiene `NoopPaymentProvider`.
  Implementar `MercadoPagoProvider` (misma interfaz `PaymentProvider`) y
  cambiar el `useClass` en `payments.module.ts` es todo lo que hace falta
  para que `TransactionsModule` empiece a usarlo — no requiere tocar
  `TransactionsService`.
- **Balance/wallet del usuario.** El mock de `trading-app-ionic/` (Tab 1)
  muestra un balance de tesorería fijo; deliberadamente no se modeló un
  campo `balance` en `User` — eso se deriva de las transacciones reales o
  se agrega junto con la integración de pagos real, para no anticipar un
  diseño que todavía no está definido.
- **Export ONNX de Stage 4 (grader de condición) y Stage 1** — vive en
  `Proyecto/certamen_2/`, no en este backend; ver
  [Proyecto/examen/README.md](../Proyecto/examen/README.md).

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
