# Storylines — video Examen Parte 1 (O18)

Fijo en las tres: el guion de `GUION.md` (las voces de los tres integrantes marcan el ritmo), 16:9 1920×1080 a 30 fps,
~12,5–13 min, las tomas reales de la app (`assets/clips/s08…s10b`) se mantienen tal cual. Lo que cambia es cómo se
cuenta visualmente cada actividad y qué reemplaza a las tomas de terminal (que pasan a ser animaciones con los
valores reales que salieron en esas tomas).

## A · "Los datos de Marta" (recomendada: un solo hilo que el profesor puede seguir de punta a punta)

- **Dispositivo / forma:** un ejemplo trabajado + cadena objeto a objeto. Marta, una vendedora de prueba, y sus datos
  (correo, contraseña, ubicación, una venta) son el objeto que viaja por todo el video. Cada actividad le hace algo
  visible a uno de esos datos: la contraseña se convierte en hash, la ubicación se redondea y se cifra, su id se vuelve
  un seudónimo, su consentimiento es un interruptor cableado a la ubicación, su solicitud recorre un riel de estados,
  y al final alguien le roba la cuenta y el registro la reconstruye.
- **Primeros 2 s:** la ficha de Marta en la app (alias, km, una carta a la venta) y, encima, sus datos personales se
  separan como piezas etiquetadas: "correo · contraseña · ubicación · compra".
- **Beats:** ficha de Marta → mapa de flujos (Hito 1) donde viajan sus piezas → cada pieza se transforma (Act. 2) →
  la base de datos se encoge y su id se vuelve `u_…` (Act. 4) → puertas por rol → interruptor de consentimiento →
  riel de derechos → el ataque a su cuenta y la cadena que lo delata (Act. 7) → lista de pendientes → cierre.
- **Look:** el de la propia app: fondo carmesí casi negro, títulos en serif de versalitas dorada (como "Nexo de
  Comercio"), texto en sans; un único material: tarjetas de pergamino oscuro con borde dorado, que es como la app
  muestra sus paneles. Tipografía monoespaciada solo para valores reales (hash, `v1:…`, `u_…`).
- **Sonido:** las tres voces encima de una base instrumental suave y constante (gratis, sin voz sintética), y un "tic"
  corto cada vez que un dato se transforma.

## B · "La partida" (la atrevida: el sistema juega contra un atacante)

- **Dispositivo / forma:** un personaje hace el trabajo + cortes con causa. Cada control de seguridad es una carta
  original (diseño propio, no el marco de Magic) que el equipo "juega" sobre la mesa: "Cifrado AES-256-GCM", "Rol de
  soporte con motivo", "Bloqueo art. 8 ter"… Cada carta trae su artículo de ley como costo y su efecto como texto. En la
  Actividad 7 entra el oponente (el atacante) y la partida se resuelve con las alertas y la reconstrucción.
- **Primeros 2 s:** una mano de cartas se abre en abanico sobre el paño rojo de las fotos reales del escáner; la de
  arriba se da vuelta: "Ley 19.628 · texto Ley 21.719".
- **Beats:** la mesa y los jugadores (apertura) → el mazo se arma con el inventario (Hito 1) → cada actividad juega
  sus cartas → aparece el oponente → la cadena de auditoría lo detiene → cartas aún en el mazo (pendientes) → cierre.
- **Look:** paño rojo real de las fotos del escáner como suelo, cartas con borde dorado y tipografía serif, cámara
  cenital que se acerca a cada carta.
- **Sonido:** voces + base suave; sonido de carta deslizándose y golpe sobre la mesa en cada jugada.

## C · "Vuelo por el sistema" (la más técnica)

- **Dispositivo / forma:** el objeto es la explicación + un vuelo por un solo mundo. Un mapa isométrico vectorial del
  sistema real (teléfono con la IA local → API NestJS → PostgreSQL → bucket de fotos → AWS / MercadoPago / correo) por
  el que la cámara viaja; cada actividad es una parada donde se enciende la capa que la implementa (cifrado en la BD,
  roles en la puerta de la API, consentimiento en el teléfono, auditoría como una cinta que recorre todo).
- **Primeros 2 s:** el teléfono escaneando una carta, y la cámara retrocede hasta mostrar todo el sistema detrás.
- **Beats:** teléfono → mapa completo → parada por actividad → la cinta de auditoría se rompe en un eslabón → vista
  final con las piezas pendientes marcadas en gris → cierre.
- **Look:** isométrico plano con la paleta carmesí/dorado de la app, líneas finas, etiquetas pegadas a cada pieza.
- **Sonido:** voces + base suave; un pulso corto cuando la cámara llega a cada parada.
