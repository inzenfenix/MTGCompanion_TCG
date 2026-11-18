# Guion — Examen Parte 1: presentación en video de MTG Companion

**Grupo:** MTG Companion · **Integrantes:** Tomás Solano, Vicente Fuentes, Tomás Rodríguez
**Duración objetivo:** ~13 min (pauta: 10–15) · **Reparto:** ~4 min de voz por integrante
**ROADMAP:** O18 · issue #152

Cada actividad se presenta con los tres puntos que pide la pauta, en este orden:
**① requisito legal o principio → ② qué implementamos y cómo → ③ demo funcionando.**

Marco legal citado en todo el video: **Ley 19.628 en el texto que le da la Ley 21.719**
(vigente desde el 01-12-2026), igual que en los informes de `docs/security/`.

---

## Resumen de tiempos

| # | Escena | Quién | Tiempo aprox. |
|---|---|---|---|
| 0 | Intro animada (sin voz) | — | 0:00–0:08 |
| 1 | Apertura: integrantes y plan del video | Tomás Solano | 0:08–0:45 |
| 2 | El caso: qué es MTG Companion | Tomás Solano | 0:45–1:45 |
| 3 | Hito 1 — Inventario y bases de licitud | Tomás Solano | 1:45–2:45 |
| 4 | Actividad 2 — Cifrado, hashing, tokenización y firma | Tomás Solano | 2:45–4:20 |
| 5 | Actividad 4 — Minimización de la base de datos | Vicente Fuentes | 4:20–5:20 |
| 6 | Actividad 4 — Seudonimización y anonimización | Vicente Fuentes | 5:20–6:25 |
| 7 | Actividad 4 — Control de acceso por roles (RBAC) | Vicente Fuentes | 6:25–7:20 |
| 8 | Actividad 5 — Consentimiento por finalidad | Vicente Fuentes | 7:20–8:25 |
| 9 | Actividades 5 y 6 — Derechos: acceso, rectificación, supresión | Tomás Rodríguez | 8:25–9:45 |
| 10 | Actividad 6 — Canal público, oposición y bloqueo | Tomás Rodríguez | 9:45–10:50 |
| 11 | Actividad 7 — Trazabilidad, alertas e incidente simulado | Tomás Rodríguez | 10:50–12:15 |
| 12 | Cierre: lo que falta mejorar (los tres) | Los tres | 12:15–13:05 |

Los tiempos salen de contar palabras a ~150 por minuto; se ajustan cuando estén grabadas las voces.
En el cierre habla cada integrante, para emparejar los tiempos.

---

## Tomás Solano

### Escena 0 — Intro animada (0:00–0:08)

**En pantalla (HyperFrames):** logo / título "MTG Companion", subtítulo "Protección de datos personales,
implementada". Música suave, sin voz.

### Escena 1 — Apertura (0:08–0:45)

**En pantalla:** cámara o foto de los tres integrantes con sus nombres; luego un índice animado con los
tres bloques y el nombre de quien presenta cada uno.

> Hola, somos el grupo MTG Companion. Yo soy **Tomás Solano**, y me acompañan Vicente Fuentes y Tomás
> Rodríguez. En este video les mostramos el software de nuestro caso funcionando. Para cada actividad del
> proyecto integrador vamos a explicar tres cosas: qué requisito legal atiende, qué implementamos y cómo,
> y la vamos a ver funcionando. Yo parto con el caso, el inventario de datos y el cifrado. Vicente sigue
> con la base de datos, el control de acceso y el consentimiento. Y Tomás cierra con los derechos de los
> titulares y la trazabilidad.

### Escena 2 — El caso (0:45–1:45)

**En pantalla:** animación del escáner (cámara → reconocer la carta → leer su texto → estimar la condición,
todo dentro del teléfono). Luego las tomas reales `s02a_bazar_compra` (Bazar con km → detalle con foto real →
oferta → "¡Ganaste la subasta!" → MercadoPago / Efectivo → venta completa) y `s02b_qr_vendedor` (el vendedor
elige la carta, fija el precio y genera el QR firmado). Al final, el mapa del sistema: teléfono (IA local) ⇄
backend NestJS + PostgreSQL en AWS.

> MTG Companion es una app para comprar, vender e intercambiar cartas de Magic. Lo que la diferencia es
> el escáner: apuntas la cámara a una carta y modelos de inteligencia artificial que corren en el propio
> teléfono reconocen que es una carta, leen su texto para identificarla y estiman su condición. Las
> imágenes de la cámara nunca llegan a nuestro servidor. Desde ahí el jugador publica la carta en el
> Bazar, donde otros la encuentran, ven a cuántos kilómetros está el vendedor, ofertan y la compran,
> pagando con MercadoPago o en efectivo. Y en una venta en persona, el vendedor genera un código QR
> firmado que el comprador escanea. Detrás hay un backend en NestJS con PostgreSQL, desplegado en AWS. Es decir:
> tratamos cuentas, contraseñas, ubicación, pagos e historial de compras de personas reales. Por eso la
> protección de datos no era opcional.

### Escena 3 — Hito 1: inventario y bases de licitud (1:45–2:45)

**En pantalla:** tarjeta "Hito 1 · Inventario y clasificación" + "Ley 19.628 (texto Ley 21.719) ·
arts. 12, 13 y 16 sexies". Luego el diagrama de flujos F1–F4 (`docs/security/hito1/diagrama_flujos.png`)
animado flujo por flujo, y la tabla del inventario con la fila de geolocalización resaltada.

> Primero, el requisito: antes de proteger datos hay que saber cuáles tratamos, para qué y con qué base
> legal. Trabajamos con la Ley 19.628 en el texto que le da la Ley 21.719, que entra en vigencia el
> primero de diciembre. En el Hito 1 armamos el inventario a partir del esquema real de la base de datos:
> cada dato con su fuente, su finalidad, su base de licitud, con quién se comparte y cuánto se conserva.
> Mapeamos cuatro flujos: registro, escaneo y publicación, búsqueda con ubicación y compraventa. La
> regla fue simple: lo indispensable para el servicio se trata por contrato, artículo 13 letra c, y lo
> opcional, como la ubicación o el segundo factor, por consentimiento, artículo 12. La geolocalización
> la clasificamos como categoría especial del artículo 16 sexies, porque permite inferir dónde vive un
> vendedor. Este inventario fue nuestro mapa: cada brecha que encontramos aquí la cerramos en una
> actividad posterior.

### Escena 4 — Actividad 2: cifrado, hashing, tokenización y firma (2:45–4:20)

**En pantalla:** tarjeta "Actividad 2 · Deber de seguridad · art. 14 quinquies". Diagrama de decisión
"¿Hay que recuperar el dato?" → hash / cifrado / tokenización / firma, con el campo de cada rama.
Luego demo (terminal o Prisma Studio, letra grande):
1. fila de `users`: `passwordHash` = `$2b$12$…`;
2. fila de `user_settings`: `lastLat` = `v1:…:…:…`;
3. se altera un carácter de ese valor en la BD → la búsqueda con distancia lo rechaza;
4. `gitleaks detect` → "no leaks found";
5. el backend arrancado sin `FIELD_ENCRYPTION_KEY` → se niega a iniciar (el mensaje nombra la variable, no muestra valores).

> La Actividad 2 atiende el deber de seguridad del artículo 14 quinquies: medidas técnicas apropiadas
> al riesgo. Para cada dato nos preguntamos: ¿el sistema necesita recuperar el valor original? Si solo
> hay que compararlo, usamos hash: la contraseña va con bcrypt y los tokens de sesión con SHA-256. Si
> hay que recuperarlo, ciframos: el secreto del segundo factor y la ubicación van con AES-256-GCM, que
> además detecta si alguien alteró el valor. Si no hay que tocarlo nunca, tokenizamos: la tarjeta se
> ingresa en MercadoPago y solo guardamos una referencia. Y lo que no se debe poder falsificar, como la
> sesión o el QR de entrega, lo firmamos con HMAC. En la base de datos, la contraseña es un hash bcrypt
> y la ubicación es un texto cifrado con un prefijo de versión, para poder rotar la llave. Si altero un
> solo carácter, el backend lo rechaza. Las llaves viven en AWS Secrets Manager, nunca junto a los
> datos; sin ellas el backend no arranca, y el historial del repositorio no tiene ningún secreto. Le
> paso la palabra a Vicente.

---

## Vicente Fuentes

### Escena 5 — Actividad 4: minimización de la base de datos (4:20–5:20)

**En pantalla:** rótulo con el nombre "Vicente Fuentes". Tarjeta "Actividad 4 · Proporcionalidad ·
art. 3". Esquema antes/después (ER) con los cambios resaltados: `adultConfirmedAt`, ubicación
"~1 km · 30 días", `description` máx. 500. Demo:
1. registro con un campo extra (`phone`) → **400**; alias con un correo → **400**; sin declaración 18+ → **400**.
(La ubicación que se borra se muestra en la escena 8, en Privacidad: la pantalla Seguridad aún está a medio traducir.)

> Hola, soy **Vicente Fuentes**, y me toca la Actividad 4: el rediseño de la base de datos y el control
> de acceso. El principio central es la proporcionalidad del artículo 3: tratar solo los datos
> necesarios, con la precisión necesaria y por el tiempo necesario. Revisamos la base campo por campo.
> No pedimos fecha de nacimiento: solo guardamos cuándo el usuario declaró ser mayor de edad. No pedimos
> teléfono, RUT ni dirección, y el registro rechaza cualquier campo extra. La ubicación se redondea a un
> kilómetro antes de cifrarla, porque para mostrar una distancia no hace falta la posición exacta de la
> casa de alguien, y vence a los treinta días. Miren: si intento registrarme enviando un teléfono, la
> API responde 400, y lo mismo si pongo un correo en el alias.

### Escena 6 — Actividad 4: seudonimización y anonimización (5:20–6:25)

**En pantalla:** dos columnas "Seudonimizar (reversible con llave)" / "Anonimizar (irreversible)".
Demo:
1. fila de `audit_logs` con `actorPseudonym = u_…` y `targetPseudonym = u_…`;
2. estado público de una subasta: `bidderAlias` en vez de `bidderId`; el mismo jugador con otro alias en otra carta;
3. `GET /admin/reports/sales` → celdas con `k: 5` y `suppressedCells`;
4. `npm run db:anonymize` sobre una copia → correos `user-<n>@example.invalid`.

> Segundo: seudonimización y anonimización, que no son lo mismo. Un seudónimo se puede revertir con una
> llave; un dato anonimizado, no. Usamos seudónimos donde hay que poder investigar: en el registro de
> auditoría, quién actuó y a quién afectó se guardan como un HMAC con llave secreta, nunca como el id
> real ni el correo. En las subastas, cada postor aparece con un alias distinto en cada carta, para que
> nadie lo siga de una a otra. Y anonimizamos donde no hace falta saber quién es: el reporte de ventas
> solo muestra las celdas que respaldan al menos cinco compradores y cinco vendedores distintos, es decir,
> k-anonimato con k igual a cinco. Las copias de la base para desarrollo pasan por un script que
> reemplaza correos y nombres y borra ubicaciones, sesiones y pagos. Revertir un seudónimo solo lo puede
> hacer un administrador, indicando un motivo, y queda registrado.

### Escena 7 — Actividad 4: control de acceso por roles (6:25–7:20)

**En pantalla:** matriz de permisos USER / SUPPORT / ADMIN animada (filas clave de `ACTIVIDAD_4.md` §3.2).
Demo (terminal, peticiones a la API):
1. usuario A pide la transacción de B → **403**;
2. SUPPORT pide las transacciones de B sin motivo → **400**; con motivo → **200**, y aparece la fila `support.transactions.read` en la auditoría;
3. `GET /admin/users` → correos enmascarados `v***@e***.com`;
4. ADMIN intenta cambiar su propio rol → denegado.

> Tercero: control de acceso basado en roles. Definimos tres roles, usuario, soporte y administrador,
> con una matriz de permisos que además está escrita como prueba automática: si alguien amplía un rol
> sin actualizar la matriz, la prueba falla. Al revisar el código encontramos algo grave: tres rutas de
> transacciones respondían sin sesión, y cualquiera con un id podía ver quién compró qué y por cuánto.
> Lo corregimos. Un usuario que pide la compra de otro recibe 403. Soporte sí puede consultarla para
> resolver una disputa, pero tiene que escribir un motivo, y esa consulta queda en la auditoría. Y el
> administrador ve los correos enmascarados y no puede cambiar su propio rol.

### Escena 8 — Actividad 5: consentimiento por finalidad (7:20–8:25)

**En pantalla:** tarjeta "Actividad 5 · Consentimiento · arts. 12 y 16 sexies". Demo en la app:
pantalla **Privacidad y mis datos** → las tres finalidades con su texto y versión → revocar
"Ubicación" → historial de cambios → en la BD `lastLat`/`lastLng` quedan en `NULL` → la app intenta
enviar la ubicación → **403**.

> En la Actividad 5 implementamos el consentimiento. El artículo 12 exige que sea libre, informado,
> específico para cada finalidad y revocable en cualquier momento, y el 16 sexies agrega requisitos para
> la geolocalización. Cada finalidad, ubicación, correos opcionales y segundo factor, tiene su propio
> consentimiento, con su texto exacto versionado. Guardamos qué versión se aceptó y el hash del texto
> mostrado, en un historial que la base de datos no deja modificar. Nada viene pre-marcado, y aceptar una
> finalidad no habilita las otras. Lo más importante es que la revocación tiene efecto real: el sistema
> revisa el consentimiento justo antes de usar el dato. Aquí revoco la ubicación, y en la misma
> operación se borran las coordenadas guardadas. Si la app intenta enviarlas de nuevo, la API responde
> 403. Le paso la palabra a Tomás.

---

## Tomás Rodríguez

### Escena 9 — Derechos: acceso, rectificación y supresión (8:25–9:45)

**En pantalla:** rótulo "Tomás Rodríguez". Tarjeta "Actividades 5 y 6 · Derechos del titular ·
arts. 5–9 y 11". Diagrama del ciclo de vida RECEPCIÓN → VERIFICACIÓN → EVALUACIÓN → EJECUCIÓN → CIERRE.
Demo en la app (Privacidad y mis datos → Mis derechos):
1. "Descargar mis datos" → pide contraseña (*step-up*) → se descarga el JSON (mostrar `processing` y `notIncluded`);
2. cambio de correo → sesión cerrada + correo de aviso a la dirección anterior (MailHog);
3. "Eliminar mi cuenta" con una venta pendiente → denegada con motivo `OPEN_TRANSACTIONS`;
4. "Mis solicitudes" con estados y plazos.

> Hola, soy **Tomás Rodríguez**, y voy con los derechos de los titulares, las Actividades 5 y 6. La ley
> da derecho de acceso, rectificación, supresión, oposición, portabilidad y bloqueo, y el artículo 11
> exige un canal, verificar la identidad y responder por escrito dentro de plazo. Todo se pide desde la
> app, y cada solicitud tiene un ciclo de vida registrado con su plazo legal. La verificación es
> proporcional al riesgo: para cambiar el alias basta la sesión, pero para descargar todos los datos,
> cambiar el correo o borrar la cuenta pedimos de nuevo la contraseña, con un permiso que dura cinco
> minutos y sirve una sola vez. El acceso entrega un JSON estructurado, que sirve también como
> portabilidad, sin credenciales ni datos de otros jugadores. Si cambio el correo, se cierran todas las
> sesiones y se avisa a la dirección anterior. Y si pido borrar mi cuenta con una venta pendiente, se
> deniega con su motivo. Cuando procede se borra todo, salvo las transacciones cerradas, que la ley
> tributaria obliga a conservar seis años y que quedan apuntando a una cuenta anónima.

### Escena 10 — Actividad 6: canal público, oposición y bloqueo (9:45–10:50)

**En pantalla:** tarjeta "Actividad 6 · Oposición (art. 8) · Bloqueo (art. 8 ter)". Demo:
1. página pública `/derechos` → enviar con un correo registrado y con uno inexistente → **misma respuesta**;
2. oposición a `SALES_STATISTICS` → acogida → celda del reporte **6 → 5**;
3. oposición a `SECURITY_MONITORING` → denegada con fundamento (pantalla y correo);
4. bloqueo → la carta del titular desaparece del Bazar → una oferta nueva → **409** → levantar el bloqueo → la oferta vuelve a **201**.

> En la Actividad 6 agregamos lo que faltaba. Primero, un canal público para quien no puede entrar a la
> app: un formulario que responde exactamente igual exista o no la cuenta, para que no sirva para
> averiguar quién está registrado, y que se confirma con un código enviado al correo. Segundo, el
> derecho de oposición del artículo 8, para los tratamientos basados en interés legítimo. Si alguien se
> opone a las estadísticas de ventas, se acoge: la celda del reporte baja de seis ventas a cinco. Si se
> opone al monitoreo de seguridad, se deniega con fundamento, porque hay motivos legítimos imperiosos.
> Y tercero, el bloqueo del artículo 8 ter, que suspende el tratamiento sin borrar nada, por ejemplo
> mientras se resuelve otra solicitud. Con el bloqueo activo, sus cartas desaparecen del Bazar y una
> oferta nueva es rechazada.

### Escena 11 — Actividad 7: trazabilidad, alertas e incidente simulado (10:50–12:15)

**En pantalla:** tarjeta "Actividad 7 · Seguridad y reporte de vulneraciones · arts. 14 quinquies y
14 sexies". Animación de la cadena de hash: se edita una fila → la cadena se rompe en ese eslabón.
Demo (terminal, letra grande):
1. `GET /admin/security/audit/verify` → OK; tras editar una fila a mano → `brokenAt`;
2. el guion del incidente de *marta* (`apps/backend/test/evidence/actividad7.mjs`) corriendo → alertas `transactions.enumeration` y `account.takeover.sequence` → el token del atacante da **401**;
3. `npm run incident:timeline -- --alert <id>` → la línea de tiempo reconstruida, con *pedro* como afectado.
Cerrar con una toma del `PLAN_RESPUESTA_INCIDENTES.md` (fases, matriz RACI, plantillas de notificación).

> Por último, la Actividad 7: trazabilidad y respuesta a incidentes, que responde al deber de seguridad
> y al artículo 14 sexies, que obliga a reportar las vulneraciones. El registro de auditoría tiene un
> catálogo de cuarenta y ocho eventos definido en el código, y registra también las lecturas de datos
> personales, siempre con seudónimos y nunca con contenidos. Es de solo agregar y cada fila está
> encadenada con un HMAC: si alguien edita una fila, la verificación marca exactamente dónde se rompió.
> Sobre ese registro corren alertas pensadas para nuestro sistema, como alguien que busca desde muchos
> lugares para triangular dónde vive un vendedor, o una cuenta que cambia su correo y exporta sus datos
> en menos de una hora. Lo probamos con un incidente simulado: alguien entra a la cuenta de Marta con
> una contraseña filtrada, sondea compras ajenas, cambia el correo y exporta los datos. El sistema
> levanta la alerta, revoca sus sesiones y su siguiente petición es rechazada. Siguiendo nuestro plan
> de respuesta, el administrador preserva la evidencia y reconstruye el incidente solo desde el
> registro: cada paso del ataque, y a qué otro usuario afectó, para poder notificarlo.

### Escena 12 — Cierre: lo que falta mejorar (12:15–13:05)

**En pantalla:** lista animada de pendientes, cada uno con su nombre de integrante; al final, los tres
nombres y "Gracias".

> **Vicente Fuentes:** ¿Qué nos queda por mejorar? Lo más urgente es TLS: hoy el tráfico hacia el
> servidor en AWS no va cifrado, y ese es nuestro mayor riesgo. También falta conectar en producción el
> rol de base de datos con mínimo privilegio.
>
> **Tomás Solano:** Falta un límite de peticiones en la red, probar el envío real de correos y guardar la
> ubicación solo de quienes venden.
>
> **Tomás Rodríguez:** Y si algún día aceptamos menores, un flujo con sus representantes. Lo que nos
> llevamos es que la privacidad se implementa en el código: cada artículo que citamos tiene una prueba
> que lo verifica. Gracias.

---

## Lista de grabación

### Reglas para todas las tomas (pauta: "solo datos de prueba")

- Solo cuentas ficticias `@example.com` (*marta*, *pedro*, *bruno*, *dani*…) sobre una base local
  sembrada para la demo. Ningún dato real.
- **Nunca** mostrar `.env`, `terraform.tfvars`, llaves, `JWT_SECRET` ni tokens completos. Al hacer
  peticiones a la API, recortar el `Authorization: Bearer …` de la pantalla o usar variables (`$TOKEN`).
- Las contraseñas se escriben solo en campos enmascarados.
- Pantalla a 1920×1080, letra de terminal ≥ 18 pt, tema claro u oscuro, pero el mismo en todas las tomas.
- Las tomas de la app móvil se graban en el navegador con la vista de dispositivo (ancho de teléfono)
  para que se vean nítidas.

### Voces

Cada integrante graba **su propia voz** (la pauta exige que todos presenten). Un archivo por escena,
en un lugar silencioso, con el micrófono a un palmo:

| Archivo | Quién | Escena |
|---|---|---|
| `assets/audio/s01_solano.wav` … `s04_solano.wav` | Tomás Solano | 1–4 |
| `assets/audio/s05_fuentes.wav` … `s08_fuentes.wav` | Vicente Fuentes | 5–8 |
| `assets/audio/s09_rodriguez.wav` … `s11_rodriguez.wav` | Tomás Rodríguez | 9–11 |
| `assets/audio/s12_rodriguez.wav`, `s12_fuentes.wav`, `s12_solano.wav` | Los tres | 12 |

WAV o M4A, cualquiera sirve. El montaje ajusta la duración de cada escena al largo de su audio.

### Tomas de pantalla

| Archivo | Escena | Qué mostrar |
|---|---|---|
| `assets/clips/s02a_bazar_compra.mp4`, `s02b_qr_vendedor.mp4` | 2 | Bazar con km → comprar (oferta, medio de pago); el vendedor genera el QR |
| `assets/clips/s04_bd_cifrado.mp4` | 4 | hash bcrypt, ubicación `v1:…`, alteración rechazada |
| `assets/clips/s04_llaves.mp4` | 4 | gitleaks limpio, backend sin llave no arranca |
| `assets/clips/s05_minimizacion.mp4` | 5 | registro con campo extra → 400; interruptor de ubicación |
| `assets/clips/s06_seudonimos.mp4` | 6 | auditoría con `u_…`, alias de subasta, reporte k=5 |
| `assets/clips/s07_rbac.mp4` | 7 | 403 ajeno, soporte con motivo, correos enmascarados |
| `assets/clips/s08_consentimiento.mp4` | 8 | Privacidad → revocar ubicación → historial → 403 |
| `assets/clips/s09_derechos.mp4` | 9 | exportación con step-up, cambio de correo, supresión denegada |
| `assets/clips/s10_oposicion_bloqueo.mp4` | 10 | `/derechos`, oposición 6→5, denegación fundada, bloqueo 409 |
| `assets/clips/s11_incidente.mp4` | 11 | verificación de cadena, incidente de *marta*, línea de tiempo |

Las tarjetas, diagramas, rótulos con nombres y transiciones se construyen en HyperFrames.
Las tomas solo tienen que capturar el software funcionando.
