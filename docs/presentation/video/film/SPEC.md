# SPEC — MTG Companion · Examen Parte 1 (ROADMAP O18)

Storyline: mezcla de `../STORYLINES.md` — **A** (los datos de Marta son el hilo) + **B** (cada control se "juega"
como una carta propia) + **C** (el mapa del sistema es el escenario base para Hito 1, el escáner y el incidente).

GOAL:    el profesor termina entendiendo, actividad por actividad, qué artículo se cumple, cómo lo hace el código
         y que funciona de verdad (tomas reales como prueba).
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps.
TIME:    ~12,5–13 min (~23 000 frames). La voz de cada integrante marca el ritmo; hasta tener las grabaciones,
         cada escena se cronometra a 150 palabras/min del guion (`../GUION.md`). Sin música con pulso fijo.
LOOK:    el de la propia app, como material "carta sobre paño":
         - suelo: foto real del paño rojo de las fotos del escáner (`assets/media/pano.jpg`), desenfoque 2,2 px,
           brillo −20 %; nunca un vacío oscuro liso.
         - carta: 560 x 784 px, radio 26 px, borde oro #d4af37 de 6 px, cuerpo pergamino oscuro #1f1512, sombra
           0 24 px 48 px rgba(0,0,0,.55). Diseño propio (no el marco de Magic).
         - papeleta de dato: pergamino #f2e3cd, tinta #2a2018, radio 10 px, sombra 0 10 px 24 px rgba(0,0,0,.45).
         - tinta clara #f2e3cd; acento oro #d4af37 solo en: el artículo de ley de cada carta y la palabra clave de
           cada línea; rojo #ff5a4f solo para lo que falla o se rechaza (403, 500, un carácter alterado).
         - display: Cinzel 700, versalitas, tracking +2 %, 64–96 px; texto: Inter 400/700, 30–40 px;
           valores reales (hash, v1:…, u_…): JetBrains Mono 34–46 px.
OBJECTS: carta (control jugado), papeleta (un dato de Marta), bóveda (MercadoPago / Secrets Manager), sello de
         lacre "HMAC", plato del servidor con su luz de estado, monitor con borde de la app para las tomas reales.
MOTION:  llegada expo.out 0,6–0.9 s; movimiento power2.inOut 0,7 s; salida power3.in 0,35 s (45 % de la llegada);
         palabras 80 ms entre sí con blur 6→0 en 0,13 s; caracteres de un valor 22 ms entre sí; resorte de la carta
         back.out(1.3) solo en posición/escala. Un movimiento protagonista por toma; el resto quieto.
SHOTS:   (escena 4 — muestra de estilo, 40 s)
         0–5,5 s   la carta "Deber de seguridad · art. 14 quinquies" cae de canto y se da vuelta sobre el paño.
         5,5–11 s  la carta se retira al costado; la pregunta "¿El sistema necesita recuperar el dato original?".
         11–20 s   papeleta "contraseña ••••••••" → se escribe el hash real `$2b$12$qJtU1…` · HASH bcrypt.
         20–30 s   papeleta "ubicación −33.4372, −70.6506" → se recorta a 2 decimales (~1 km) → `v1:iv:tag:texto`
                   con cada parte rotulada · CIFRADO AES-256-GCM.
         30–36 s   un carácter del texto cifrado cambia a rojo; el plato del servidor marca "500 · falla cerrado".
         36–40 s   prueba: monitor con la toma real (`s04_cifrado.mp4` 29,5–33,5 s) y rótulo "grabación real".
BANNED:  vacío oscuro liso; glow, partículas, orbes; degradados morados/azules y vidrio; papel crema con serif +
         etiquetas mono en mayúsculas; todo centrado; todo entrando con fade + subida; títulos que se mueven
         mientras se leen; tres tarjetas en fila; logo en una esquina; texto de terminal como imagen de fondo.
QA:      2,5 s (carta en vuelo), 5 s (carta asentada, legible), 9 s (pregunta completa), 18 s (hash completo),
         28 s (v1 con sus cuatro rótulos), 34 s (carácter rojo + 500), 38 s (monitor con la toma real nítida).
