"""
MTG Card Scanner — Certamen 2
card_preprocessing.py: localización + normalización de la carta en una foto.

Antes de esto, cada etapa hacía su propio recorte ad-hoc asumiendo que la
foto ya era "solo la carta" (cierto para los renders de Scryfall, falso para
una foto de celular real con mesa/mano/fondo alrededor). Este módulo hace el
trabajo una sola vez — localizar el rectángulo de la carta, corregir
perspectiva, normalizar tamaño/contraste — para que Stage 2 (OCR) y el futuro
Stage 4 (condición) trabajen sobre la misma carta ya encuadrada en vez de
cada uno adivinar coordenadas fijas sobre la foto cruda.

Es el equivalente en Python de lo que OpenCV.js hará del lado del cliente en
la app Ionic (ver examen/README.md) — mismo algoritmo, sirve también como
referencia de qué portar a JS más adelante.

Pipeline (`normalizar_carta`):
    1. Canny + contornos → buscar el cuadrilátero más grande cuyo aspect
       ratio se parezca al de una carta MTG (63×88 mm).
    2. Si se encuentra: `cv2.getPerspectiveTransform` + `warpPerspective` a
       un tamaño canónico fijo.
    3. Si NO se encuentra (foto ya es un recorte ajustado, o el fondo no
       tiene contraste suficiente contra el borde de la carta): fallback a
       usar la imagen completa redimensionada — nunca rompe el pipeline por
       no encontrar un contorno.

`mejorar_contraste` (CLAHE) es un paso aparte, opcional: normaliza
iluminación desigual sin lavar el color — ayuda tanto al OCR como a que un
futuro clasificador de condición vea scratches/whitening de forma más
consistente entre fotos con distinta luz.
"""

from __future__ import annotations

import cv2
import numpy as np

ASPECT_RATIO_CARTA = 63 / 88  # ancho/alto de una carta MTG estándar (mm)
TOLERANCIA_ASPECT_RATIO = 0.18
AREA_MINIMA_FRACCION = 0.15  # el contorno candidato debe cubrir >= 15% del frame

ANCHO_CANONICO = 750
ALTO_CANONICO = 1050

# ROADMAP.md I33/I41 — kernel de apertura/cierre morfológico como FRACCIÓN
# de la resolución de la máscara, no un conteo de píxeles fijo. Puerto tardío
# a este archivo (fuente de la verdad) de un fix que I41 solo aplicó a
# `cardLocalizer.ts` — encontrado en vivo el 20 ago diagnosticando por qué
# `localizar_carta()` fallaba en el 59% de las fotos reales de
# `real_negatives` (81 fotos, cámara de celular real, 4000x3000+ px):
# `_mascara_saturacion`/`_mascara_brillo` usaban un cierre de 25px fijo —
# a esa resolución eso es un gap casi nulo, así que cualquier fondo con
# textura (escritorio, teclado, ropa) fragmenta la máscara en decenas de
# blobs pequeños en vez de un blob limpio de "toda la carta" (confirmado
# directamente: 23/48 fallos medidos no tenían NINGÚN contorno que llegara
# siquiera al piso de área mínima del 15% del frame). Exactamente el mismo
# mecanismo que I41 ya diagnosticó y arregló para el caso de close-up en
# `cardLocalizer.ts` — solo que ese fix nunca se portó de vuelta acá, contra
# la convención de "Python es la fuente de la verdad" que el resto de este
# archivo sigue.
#
# `cardLocalizer.ts`'s propios valores (OPEN=0.0375, CLOSE=0.08, medidos
# ahí contra un trapezoide SINTÉTICO de ~400px en `cardLocalizer.test.ts`)
# NO se copiaron acá tal cual — probados primero contra datos reales,
# empeoraron el find-rate (40.7% -> 38.3% sobre `real_negatives`) Y
# rompieron una foto que antes pasaba en el propio set de 122 fotos
# (`real_photos/20260815_164401.jpg`, confirmado aislando la causa: no fue
# CLOSE, fue OPEN). A la resolución real de estas fotos (3000-8000px de
# lado corto), 0.0375 de OPEN es un kernel de 100px+ — mucho más agresivo
# que el 15px fijo original — y erosiona la máscara de la carta lo bastante
# como para perderla en esa foto específica, mientras que CLOSE=0.08 (240px+)
# sobre-fusiona carta+fondo en un blob que supera `AREA_MAXIMA_FRACCION`.
# Ambos son artefactos de escalar linealmente una fracción calibrada a
# ~400px hasta resoluciones 10-20x mayores, no un problema del enfoque
# fraccional en sí.
#
# Valores finales, elegidos por barrido real (`i33_sweep*.py`, scratch, no
# comiteados) contra el dataset COMPLETO — 81 fotos de `real_negatives` +
# las 122 de `real_photos` (fondo uniforme, sirve de chequeo de regresión
# duro: CERO tolerancia a bajar de 122/122 ahí). El paisaje no es monótono
# (kernels de pocos píxeles en resoluciones distintas producen saltos
# discretos, no una curva suave) — candidatos con OPEN alto (0.025-0.0375)
# rondan 44-48% pero SIEMPRE a costa de esa foto de `real_photos`; bajar
# OPEN a 0.02 es el punto donde el find-rate de `real_negatives` (46.9%,
# 38/81) ya no cuesta esa regresión (122/122 se mantiene intacto en TODOS
# los CLOSE probados con OPEN=0.02). CLOSE=0.04 es el mejor punto en ese
# eje (0.03->45.7%, 0.04->46.9%, 0.05->24.7%, 0.06->19.8%, 0.08->21.0% —
# de nuevo no monótono, 0.04 es un óptimo local real, no un valor de en
# medio elegido a ojo). Resultado neto: +6.2 puntos reales de find-rate
# sobre el kernel fijo original (25px), sin perder ni una sola foto del
# set de regresión de 122. Ver `localizer_eval.py` / la fila I33 en
# ROADMAP.md para las corridas completas y el caveat de que `real_negatives`
# incluye un puñado de fotos deliberadamente difíciles (ángulos extremos,
# carta cortada por el borde del cuadro) tomadas a propósito para estresar
# el localizador — no todo el 53.1% que sigue sin encontrarse es
# necesariamente "arreglable" con este tipo de fix.
OPEN_KERNEL_FRACCION = 0.02
CLOSE_KERNEL_FRACCION = 0.04

# ROADMAP.md G4e (sleeve follow-up) — umbral de "punto de brillo especular":
# value muy alto (casi blanco/sobreexpuesto) + saturación muy baja (casi sin
# color) es la firma clásica de un reflejo de luz sobre una superficie
# brillante — exactamente lo que agrega una funda de plástico transparente
# que una carta desnuda (mate) no produce. No validado contra fotos reales
# con funda (el dataset de 122 fotos es sin funda) — son umbrales de partida
# razonables, no medidos; ver docstring de `detectar_brillo_especular`.
BRILLO_ESPECULAR_VALUE_MIN = 235  # 0-255, canal V (HSV)
BRILLO_ESPECULAR_SAT_MAX = 25  # 0-255, canal S (HSV)
BRILLO_ESPECULAR_FRACCION_AVISO = 0.03  # >= 3% del área de la carta -> avisar

# ROADMAP.md G4e (sleeve follow-up, capa 3) — umbral de "posible funda
# opaca / sin contenido de carta visible": una carta MTG real, incluso NM,
# siempre tiene bordes estructurales fuertes (marco negro, caja de texto,
# panel de arte, símbolos de maná, texto de reglas) y variación de color
# alta (arte + texto + fondos de color). El reverso de una funda opaca, o
# una funda de color mirando a cámara, no tiene ninguna de las dos cosas —
# es esencialmente un blob de color casi uniforme. No es una detección de
# funda en sí (no se puede distinguir "funda opaca" de "foto borrosa/mal
# encuadrada" con esta heurística sola) — el punto es más honesto: "no hay
# contenido de carta reconocible para calificar condición", cualquiera sea
# la causa. Validado (16 ago) contra las 122 fotos reales normalizadas del
# dataset G4b/G4c: 0 falsos positivos.
FUNDA_OPACA_EDGE_FRACCION_MAX = 0.02  # fracción de píxeles de borde (Canny) por debajo de la cual se considera "sin estructura"
FUNDA_OPACA_STD_MAX = 15.0  # desviación estándar de grises por debajo de la cual se considera "color casi uniforme"

# ROADMAP.md I19/I22/I23 — desenfoque (motion blur o foco fuera de rango)
# degrada TODO lo que corre después de la captura: Stage 1, la localización
# misma, y sobre todo el OCR de identifyCard.ts (una foto borrosa produce
# texto ilegible incluso con el recorte geométrico ya arreglado — visto en
# vivo esta misma sesión). Varianza del Laplaciano es la heurística clásica
# de nitidez (Pech-Pacheco et al.) — una imagen nítida tiene muchos bordes de
# alto contraste (varianza alta tras el filtro de segunda derivada), una
# borrosa los pierde (varianza baja). Umbral de partida, NO medido contra un
# corpus real de fotos borrosas en este dispositivo — sí se hizo una
# calibración aproximada (no en el dataset real, sobre 2 fotos reales de esta
# sesión reducidas a resolución de pantalla): nítidas ~75-130, la misma
# imagen emborronada artificialmente (downscale+upscale 8x) ~2-2.5 — más de
# 30x de margen, motivo por el que 15 es un umbral conservador razonable acá,
# no una medición real en la resolución/cámara final. Ajustar si en uso real
# resulta muy laxo/estricto.
DESENFOQUE_LAPLACIAN_VAR_MIN = 15.0

# ROADMAP.md G4e, dirección (a) — rechazo de candidatos "color piel" en el
# localizador geométrico mismo (en vez de depender solo del gate de Stage 1
# en GuidedCapture.tsx, que ya cubre este caso en la práctica — ver el
# hallazgo original de G4c: un rectángulo sintético con tono de piel matcheó
# como "encontrado" con buen score, a veces superando detecciones reales de
# carta). Rango YCrCb clásico de segmentación de piel (Cr en [133,173], Cb en
# [77,127], cualquier Y) — heurística estándar y ampliamente usada
# precisamente porque separa crominancia de luminancia, por lo que es
# razonablemente robusta a variaciones de iluminación (a diferencia de un
# rango directo en RGB/HSV). No es perfecta para todos los tonos de piel ni
# entrenada específicamente para este proyecto — es un filtro adicional, no
# un reemplazo del gate de Stage 1.
YCRCB_PIEL_CR_MIN = 133
YCRCB_PIEL_CR_MAX = 173
YCRCB_PIEL_CB_MIN = 77
YCRCB_PIEL_CB_MAX = 127
# Fracción del área del candidato que, si es color-piel, lo marca como
# SOSPECHOSO de piel (todavía no descartado — ver PIEL_EDGE_FRACCION_MAX
# abajo). 0.5 = mayoría del rectángulo, no cualquier solapamiento parcial.
UMBRAL_PIEL_FRACCION = 0.5
# Segunda señal, obligatoria además de UMBRAL_PIEL_FRACCION: un candidato
# solo se descarta como piel si ADEMÁS tiene poca densidad de bordes
# (Canny) — es decir, sin estructura de carta real (marco, caja de texto,
# arte, símbolos). Sin este segundo filtro, `_mascara_piel` sola produce
# falsos positivos reales sobre cartas MTG: se midió en la práctica (16
# ago) que "Sol Ring" (arte azul/violeta sobre marco gris cálido) promedia
# 66-72% del rectángulo dentro del rango YCrCb de piel — un tono de carta
# cálido/grisáceo, no piel — mientras que una piel real (uniforme, sin
# texto/bordes internos) tiene mucha menos densidad de bordes. Mismo umbral
# que `FUNDA_OPACA_EDGE_FRACCION_MAX` (0.02) — incluso las cartas con
# candidato "color-piel" alto miden 0.034-0.038 de densidad de bordes en
# este dataset, muy por encima; una piel/rostro sintético uniforme mide
# ~0.008, muy por debajo. Validado (16 ago) contra las 122 fotos reales del
# dataset G4b/G4c: localizar_carta() se mantiene en 122/122 (100%) con este
# filtro combinado — sin la señal de bordes, bajaba a 120/122 (2 fotos de
# "Sol Ring" perdidas por el falso positivo de color).
PIEL_EDGE_FRACCION_MAX = 0.02

# ROADMAP.md I32 — el localizador a veces elige una superficie de fondo
# uniforme (ej. un mousepad negro) en vez de la carta: `_candidatos_validos`
# hasta ahora solo filtraba por área mínima + aspect-ratio + piel, sin
# ninguna noción de (a) si el candidato toca el borde del cuadro (una
# superficie de fondo suele extenderse más allá de cámara; una carta bien
# encuadrada normalmente no), (b) si tiene textura real (arte/texto) en vez
# de ser un blob de color casi uniforme, o (c) si su tamaño es plausible
# para una carta sostenida a distancia normal de captura. Los tres filtros
# de abajo se midieron contra las 122 fotos reales de G4b/G4c antes de
# elegir umbrales (`i32_measure.py`, script de una sola vez, no versionado):
#
# - `_toca_borde`: **deliberadamente NO es un filtro duro** — 5 de los 122
#   candidatos GANADORES reales miden un margen ligeramente NEGATIVO (el
#   rectángulo rotado de `cv2.minAreaRect` puede sobresalir un poco del
#   cuadro por redondeo incluso sobre una carta correctamente detectada, no
#   solo sobre una superficie de fondo) — un rechazo duro aquí regresionaría
#   esas 5 detecciones reales, exactamente el tipo de sobre-filtrado que
#   `normalizar_carta`'s propio docstring ya advierte para el caso de área/
#   solidez/extent. En cambio, tocar el borde solo AGREGA una penalización al
#   score (`PENALIZACION_BORDE`) — desempata a favor del candidato que no
#   toca el borde cuando hay más de uno, pero un candidato tocando el borde
#   sigue pudiendo ganar si es el único disponible (mejor una carta
#   ligeramente mal encuadrada que ningún candidato en absoluto, mismo
#   principio que el fallback a imagen completa de `normalizar_carta`).
BORDE_MARGEN_FRACCION = 0.01  # 1% del ancho/alto del frame
PENALIZACION_BORDE = 0.5  # >> TOLERANCIA_ASPECT_RATIO (0.18), para siempre perder contra un candidato que no toca el borde

# - `_std_en_rect` (textura): SÍ es un filtro duro — a diferencia del margen
#   de borde, la desviación estándar de grises dentro del candidato tiene
#   separación real y amplia en el dataset de 122 fotos: los candidatos
#   ganadores reales miden 41.5-59.6 (media ~51), muy por encima de
#   `FUNDA_OPACA_STD_MAX` (15, el umbral ya validado en este archivo para
#   "superficie de color casi uniforme"). 20 deja margen real (>2x) por
#   debajo del mínimo observado sin acercarse al umbral de "sin contenido"
#   ya establecido. Nota: `PIEL_EDGE_FRACCION_MAX`/densidad de bordes NO se
#   reusa aquí como filtro duro adicional — medido en el mismo dataset, el
#   candidato ganador de menor densidad de bordes real mide 0.0014 (una
#   carta real, fotografiada en ángulo, con la mayor parte del marco/arte
#   fuera del rect sin perspectiva corregir todavía) — muy por debajo de
#   `FUNDA_OPACA_EDGE_FRACCION_MAX` (0.02), así que ese umbral no es
#   transferible a este contexto (candidato SIN corregir perspectiva) sin
#   generar un falso rechazo real; std por sí solo ya separa el caso real
#   (mousepad uniforme) sin ese riesgo.
CANDIDATO_TEXTURA_STD_MIN = 20.0

# - área máxima: filtro duro simple — el candidato ganador real de mayor
#   área mide 0.583 de fracción del frame; 0.75 deja ~30% de margen real por
#   encima sin acercarse a rechazar una carta legítima fotografiada de cerca.
AREA_MAXIMA_FRACCION = 0.75

# ROADMAP.md I28b — el enfoque original de I28 medía si el TELÉFONO estaba
# nivelado respecto a la GRAVEDAD (`DeviceOrientationEvent`, beta/gamma).
# Feedback directo del usuario en vivo tras probarlo: "demasiado ajustado...
# lo que hay que igualar es el ángulo de la carta y el teléfono, si la carta
# está a 45°, el teléfono también debería estarlo — si no, es difícil
# sostenerlo tan firme". Diagnóstico correcto: nivelar respecto a la
# gravedad es la métrica equivocada — lo que realmente degrada la captura es
# que el teléfono NO esté paralelo al PLANO de la carta, sin importar el
# ángulo absoluto de ese plano respecto al suelo (una carta en la mano a
# 45°, fotografiada con el teléfono también a 45° respecto a ella, produce
# una foto tan buena como una perfectamente nivelada). Ese desalineamiento
# relativo ya es medible directamente de la imagen, sin ningún sensor: una
# carta rectangular fotografiada exactamente de frente (teléfono paralelo a
# la carta) siempre proyecta lados opuestos de igual longitud, sin importar
# la rotación/ángulo absoluto del plano — cualquier keystone (lados opuestos
# de longitud distinta) es exactamente la señal de desalineamiento relativo
# que `useDeviceTilt`/`DeviceOrientationEvent` intentaba aproximar indirecta
# y ruidosamente vía gravedad. `medir_desalineacion()` abajo mide esto
# directamente sobre las esquinas que `localizar_carta()` ya calcula cada
# frame — cero costo extra, cero permisos de sensor, cero ambigüedad de
# convención de ejes (todo lo que I28 dejó "no verificado en vivo").
#
# Umbral medido contra las 122 fotos reales (`localizar_carta()` post-I32,
# no simulado), por eje SEPARADO (ver `medir_desalineacion()` — un eje
# desalineado ya es suficiente para avisar, no hace falta que ambos lo
# estén): eje horizontal (arriba/abajo, keystone por rotación tipo "yaw")
# real 0.822-1.0; eje vertical (izquierda/derecha, keystone por rotación
# tipo "pitch") real 0.909-1.0 — ese set ya se usa en todo este archivo como
# el bar de "capturas reales que funcionan en la práctica" (G4b/G4d/I25).
# 0.65 deja margen real amplio por debajo del peor caso de AMBOS ejes, para
# no repetir el mismo error de "demasiado ajustado" que motivó este cambio.
#
# Se consideró expresar esto como un umbral en GRADOS (pedido explícito del
# usuario: "algo como 8-12 grados en cada eje") en vez de un ratio de
# longitud de lados — descartado tras medir: la aproximación ingenua
# ratio≈cos(ángulo) pondría a las MEJORES fotos reales de este set en
# ~35-49° de "inclinación aparente", porque a la distancia típica de
# captura a mano el keystone está dominado por perspectiva de PROXIMIDAD
# (el borde cercano de la carta está objetivamente más cerca de la cámara
# en términos absolutos) más que por el ángulo real del plano — un tope
# literal de 8-12° bajo esa fórmula sería MÁS estricto que lo que ya
# funciona en la práctica, repitiendo el problema original. El ratio
# medido contra fotos reales es la métrica honesta acá, no un ángulo
# inventado con una fórmula que no aplica a esta distancia de captura.
DESALINEACION_RATIO_MIN = 0.65


def _toca_borde(rect, ancho_img: int, alto_img: int, margen_fraccion: float = BORDE_MARGEN_FRACCION) -> bool:
    """True si alguna esquina de `rect` (formato `cv2.minAreaRect`) cae
    dentro de (o más allá de) un margen de `margen_fraccion` del borde del
    frame. Ver el comentario junto a `PENALIZACION_BORDE` sobre por qué esto
    es un desempate y no un filtro duro (ROADMAP.md I32)."""
    box = cv2.boxPoints(rect)
    margen_x = margen_fraccion * ancho_img
    margen_y = margen_fraccion * alto_img
    return bool(
        (box[:, 0] <= margen_x).any() or (box[:, 0] >= ancho_img - margen_x).any()
        or (box[:, 1] <= margen_y).any() or (box[:, 1] >= alto_img - margen_y).any()
    )


def _std_en_rect(img_gris: np.ndarray, rect) -> float:
    """Desviación estándar de grises dentro de `rect` (formato
    `cv2.minAreaRect`) — mismo principio que `detectar_funda_opaca`
    (ROADMAP.md G4f) pero aplicado al candidato ANTES de recortar/enderezar,
    para descartar superficies de fondo uniformes (ej. un mousepad) en la
    SELECCIÓN del candidato, no solo como guard post-captura
    (ROADMAP.md I32)."""
    box = cv2.boxPoints(rect).astype(np.int32)
    mascara_rect = np.zeros(img_gris.shape, dtype=np.uint8)
    cv2.fillPoly(mascara_rect, [box], 255)
    valores = img_gris[mascara_rect == 255]
    if valores.size == 0:
        return 0.0
    return float(valores.std())


def _ordenar_esquinas(pts: np.ndarray) -> np.ndarray:
    """Ordena 4 puntos como (top-left, top-right, bottom-right, bottom-left)."""
    suma = pts.sum(axis=1)
    diferencia = np.diff(pts, axis=1).reshape(-1)
    tl = pts[np.argmin(suma)]
    br = pts[np.argmax(suma)]
    tr = pts[np.argmin(diferencia)]
    bl = pts[np.argmax(diferencia)]
    return np.array([tl, tr, br, bl], dtype="float32")


def _morph_open_close(mascara: np.ndarray) -> np.ndarray:
    """Apertura + cierre morfológico con kernels dimensionados como fracción
    del lado corto de la máscara (ROADMAP.md I33/I41) — no un tamaño de
    píxeles fijo, que en fotos de celular reales (4000px+ de lado) equivale
    a casi nada. Ver el comentario junto a `OPEN_KERNEL_FRACCION`/
    `CLOSE_KERNEL_FRACCION` para la medición real detrás de estos valores."""
    lado_corto = min(mascara.shape[:2])
    tam_apertura = max(3, round(lado_corto * OPEN_KERNEL_FRACCION))
    tam_cierre = max(3, round(lado_corto * CLOSE_KERNEL_FRACCION))
    mascara = cv2.morphologyEx(mascara, cv2.MORPH_OPEN, np.ones((tam_apertura, tam_apertura), np.uint8))
    mascara = cv2.morphologyEx(mascara, cv2.MORPH_CLOSE, np.ones((tam_cierre, tam_cierre), np.uint8))
    return mascara


def _mascara_saturacion(img_bgr: np.ndarray) -> np.ndarray:
    """Segmentación por saturación (HSV), invertida: la carta (impresión con
    zonas grises/blancas/negras — bordes, cajas de texto) suele tener MENOS
    saturación promedio que un mantel/mat de un solo color sólido y saturado.
    Complementa (no reemplaza) la segmentación por brillo: donde el brillo
    falla (carta oscura contra fondo oscuro pero saturado — funda negra
    sobre una tela roja, por ejemplo) la saturación separa bien porque mide
    algo distinto (cuán "puro"/monocromático es el color, no cuán claro).
    """
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]
    blur = cv2.GaussianBlur(sat, (9, 9), 0)
    _, mascara = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return _morph_open_close(mascara)


def _mascara_brillo(img_bgr: np.ndarray) -> np.ndarray:
    """Segmentación por brillo (Otsu), la heurística original. Se probó Canny
    primero y falló en fotos reales: el borde de una funda oscura contra una
    mesa/tela oscura tiene muy poco contraste de luminancia, así que el borde
    de la carta casi no aparece en el mapa de edges, mientras que texturas
    brillantes del fondo generan ruido que domina como "contorno más
    grande". Otsu sobre brillo (carta más clara que el fondo) + apertura/
    cierre morfológico para limpiar ruido interno da un blob mucho más
    confiable de "toda la carta" cuando SÍ hay contraste de luminancia.
    """
    gris = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gris, (9, 9), 0)
    _, mascara = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return _morph_open_close(mascara)


def _mascara_piel(img_bgr: np.ndarray) -> np.ndarray:
    """Máscara binaria (255 = piel) usando el rango YCrCb clásico de
    detección de piel — ver el comentario de `YCRCB_PIEL_*` arriba para la
    justificación. Se calcula una sola vez por imagen (como las máscaras de
    saturación/brillo) y se reutiliza para evaluar todos los candidatos."""
    ycrcb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2YCrCb)
    cr = ycrcb[:, :, 1]
    cb = ycrcb[:, :, 2]
    piel = (
        (cr >= YCRCB_PIEL_CR_MIN) & (cr <= YCRCB_PIEL_CR_MAX)
        & (cb >= YCRCB_PIEL_CB_MIN) & (cb <= YCRCB_PIEL_CB_MAX)
    )
    return (piel.astype(np.uint8)) * 255


def _mapa_bordes(img_bgr: np.ndarray) -> np.ndarray:
    """Mapa de bordes Canny — mismo mapa/umbrales que usa
    `detectar_funda_opaca()`, reutilizado aquí para decidir si un candidato
    "color-piel" en realidad tiene estructura de carta (marco, caja de
    texto, arte, símbolos) y por lo tanto NO es piel real. Se calcula una
    sola vez por imagen, igual que `_mascara_piel`."""
    gris = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    return cv2.Canny(gris, 50, 150)


def _fraccion_en_rect(mascara: np.ndarray, rect) -> float:
    """Fracción del área de `rect` (formato `cv2.minAreaRect`) que cae dentro
    de `mascara` (binaria, 255 = positivo) — genérica, usada tanto para
    color-piel como para densidad de bordes dentro de un candidato.
    Rasteriza el rectángulo rotado con `cv2.fillPoly` en vez de usar el
    bounding box axis-aligned, para no sobre-contar en rectángulos
    rotados."""
    box = cv2.boxPoints(rect).astype(np.int32)
    mascara_rect = np.zeros(mascara.shape, dtype=np.uint8)
    cv2.fillPoly(mascara_rect, [box], 255)
    area_rect = cv2.countNonZero(mascara_rect)
    if area_rect == 0:
        return 0.0
    interseccion = cv2.countNonZero(cv2.bitwise_and(mascara, mascara_rect))
    return interseccion / area_rect


def _candidatos_validos(
    mascara: np.ndarray,
    area_img: int,
    mascara_piel: np.ndarray | None = None,
    mapa_bordes: np.ndarray | None = None,
    img_gris: np.ndarray | None = None,
) -> list[tuple[np.ndarray, np.ndarray, float, float]]:
    """Todos los contornos de una máscara (no solo el más grande) que pasan
    los filtros de área/aspect-ratio/piel/textura/tamaño, como
    (contorno, rect, score, area). `score` = qué tan cerca está el aspect
    ratio del ideal de una carta MTG (0 = match perfecto), MÁS
    `PENALIZACION_BORDE` si el candidato toca el borde del frame
    (ROADMAP.md I32 — desempate, no filtro duro, ver su comentario). Evaluar
    todos y no solo el más grande es lo que permite `_descartar_contenidos`
    detectar el caso "el contorno más grande de la máscara es en realidad
    una sub-región interior de la carta" — con un solo candidato por máscara
    no hay nada contra qué compararlo.

    `mascara_piel`/`mapa_bordes` (ROADMAP.md G4e, dirección (a)) son
    opcionales — si ambos se pasan, un candidato se descarta aquí mismo
    (antes de `_descartar_contenidos`) solo cuando es MAYORMENTE color-piel
    (`UMBRAL_PIEL_FRACCION`) Y ADEMÁS tiene poca densidad de bordes
    (`PIEL_EDGE_FRACCION_MAX`) — la segunda condición es la que distingue
    piel real (uniforme, sin estructura) de una carta con tonos cálidos/
    grisáceos que por casualidad cae en el mismo rango de color (medido en
    la práctica, ver el comentario de `PIEL_EDGE_FRACCION_MAX`). Es un
    filtro por candidato (como área/aspect ratio), no una relación entre
    candidatos, así que vive en esta función.

    `img_gris` (ROADMAP.md I32) es opcional — si se pasa, un candidato con
    área mayor a `AREA_MAXIMA_FRACCION` del frame o con desviación estándar
    de grises por debajo de `CANDIDATO_TEXTURA_STD_MIN` dentro de su rect se
    descarta aquí mismo (superficie de fondo demasiado grande o demasiado
    uniforme para ser una carta real — ver los comentarios junto a esas
    constantes para los números reales que las respaldan)."""
    contornos, _ = cv2.findContours(mascara, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    ancho_img, alto_img = mascara.shape[1], mascara.shape[0]
    candidatos = []
    for contorno in contornos:
        area = cv2.contourArea(contorno)
        if area < AREA_MINIMA_FRACCION * area_img:
            continue
        if area > AREA_MAXIMA_FRACCION * area_img:
            continue

        rect = cv2.minAreaRect(contorno)
        (_, _), (ancho, alto), _ = rect
        if ancho == 0 or alto == 0:
            continue

        # ROADMAP.md I38 — real bug found live: `area` arriba es el área de
        # PÍXELES RELLENOS del contorno, no necesariamente el área del rect
        # que termina siendo las esquinas finales del warp. Un blob
        # IRREGULAR (no rectangular — ej. una escena de fondo con bordes
        # recortados/ruidosos) puede tener área rellena bajo el 75% pero un
        # `minAreaRect` (el rectángulo rotado que lo encierra, y lo que
        # `_esquinas_desde_contorno`/`corregir_perspectiva` realmente usa)
        # que cubre casi todo el frame — confirmado en vivo (un candidato
        # real con esquinas (0,0)-(w,0)-(w,h)-(0,h), score con penalización
        # de borde) y reproducido con un blob sintético (relleno 69.9%, bajo
        # el cap, pero `minAreaRect` 99.6% del frame). El filtro de área
        # mínima/máxima original solo miraba el relleno; esto agrega el
        # chequeo que realmente importa — el tamaño del rect de salida.
        if (ancho * alto) > AREA_MAXIMA_FRACCION * area_img:
            continue

        ratio = min(ancho, alto) / max(ancho, alto)
        diff = abs(ratio - ASPECT_RATIO_CARTA)
        if diff > TOLERANCIA_ASPECT_RATIO:
            continue

        if mascara_piel is not None and mapa_bordes is not None:
            fraccion_piel = _fraccion_en_rect(mascara_piel, rect)
            if fraccion_piel >= UMBRAL_PIEL_FRACCION:
                fraccion_bordes = _fraccion_en_rect(mapa_bordes, rect)
                if fraccion_bordes < PIEL_EDGE_FRACCION_MAX:
                    continue

        if img_gris is not None and _std_en_rect(img_gris, rect) < CANDIDATO_TEXTURA_STD_MIN:
            continue

        score = diff + (PENALIZACION_BORDE if _toca_borde(rect, ancho_img, alto_img) else 0.0)
        candidatos.append((contorno, rect, score, area))
    return candidatos


def _rect_contenido(interior: np.ndarray, exterior: np.ndarray) -> bool:
    """True si las 4 esquinas (`cv2.boxPoints`) de `interior` caen todas
    dentro (o justo en el borde) del rectángulo `exterior`."""
    exterior_cerrado = exterior.reshape(-1, 1, 2).astype(np.float32)
    return all(
        cv2.pointPolygonTest(exterior_cerrado, (float(x), float(y)), False) >= 0
        for x, y in interior
    )


def _descartar_contenidos(
    candidatos: list[tuple[np.ndarray, np.ndarray, float, float]],
) -> list[tuple[np.ndarray, np.ndarray, float, float]]:
    """Descarta cualquier candidato cuyo rect esté completamente contenido
    dentro de otro candidato más grande (mismo mask o el otro) — prefiere el
    contorno MÁS EXTERNO entre los que califican en vez de aceptar cualquiera
    que pase el filtro de aspect-ratio. Ataca el falso positivo "caja de
    texto o panel de arte interior comparte el aspect ratio de una carta MTG
    por casualidad" (ROADMAP.md G4e) sin reintroducir los filtros de
    área/solidez/extent que `normalizar_carta` ya documenta como probados y
    descartados para el caso de renders sin fondo — esto es una relación
    ENTRE dos candidatos (contención geométrica), no una propiedad intrínseca
    de un contorno individual, así que es un mecanismo distinto."""
    sobrevivientes = []
    for i, (contorno_i, rect_i, score_i, area_i) in enumerate(candidatos):
        puntos_i = cv2.boxPoints(rect_i)
        contenido = any(
            j != i and area_j > area_i and _rect_contenido(puntos_i, cv2.boxPoints(rect_j))
            for j, (_, rect_j, _, area_j) in enumerate(candidatos)
        )
        if not contenido:
            sobrevivientes.append((contorno_i, rect_i, score_i, area_i))
    return sobrevivientes


def _esquinas_desde_contorno(contorno: np.ndarray, rect) -> np.ndarray:
    """Intenta encontrar las 4 esquinas REALES del candidato ganador vía
    `cv2.approxPolyDP` — permite un CUADRILÁTERO GENERAL, no forzosamente un
    rectángulo. Clave para fotos tomadas en ángulo (la norma en un scanner de
    teléfono, no la excepción): una carta fotografiada así se ve como un
    TRAPECIO por distorsión de perspectiva (los lados paralelos convergen
    levemente), no como un rectángulo rotado. `cv2.minAreaRect` (lo que
    `localizar_carta` usaba hasta ahora para las esquinas finales) SIEMPRE
    devuelve un rectángulo — no puede representar ese keystoning real — así
    que `corregir_perspectiva` (una transformación de 4 puntos genuina,
    capaz de corregir un trapecio de verdad) recibía esquinas de la forma
    equivocada incluso cuando el rectángulo en sí ya era un buen fit de
    área/aspect-ratio. Encontrado en vivo esta sesión (ROADMAP.md I19/I25):
    fotos sostenidas con la mano, en ángulo, salían con una inclinación
    residual visible en el recorte "canónico" que se suponía ya enderezado —
    y esa inclinación es justo lo que rompía `CROP_NOMBRE`/OCR corriente
    abajo incluso después de arreglar la geometría del propio recorte de
    nombre.

    Fallback a `cv2.boxPoints(rect)` (el comportamiento anterior) si el
    contorno no reduce limpio a 4 puntos — formas ruidosas o parcialmente
    ocluidas (p.ej. dedos tapando un borde de la carta) donde un
    cuadrilátero de 4 puntos no es un fit confiable y el rectángulo sigue
    siendo la mejor aproximación disponible.
    """
    perimetro = cv2.arcLength(contorno, True)
    aprox = cv2.approxPolyDP(contorno, 0.02 * perimetro, True)
    if len(aprox) == 4:
        return aprox.reshape(4, 2).astype(np.float32)
    return cv2.boxPoints(rect)


def localizar_carta(img_bgr: np.ndarray) -> np.ndarray | None:
    """
    Busca el rectángulo con aspect ratio de carta MTG en la foto. Retorna las
    4 esquinas ordenadas (float32) o None si no hay un candidato confiable
    (foto ya recortada, fondo sin contraste, ángulo extremo, etc.).

    Prueba dos estrategias de segmentación independientes — saturación
    (`_mascara_saturacion`) y brillo (`_mascara_brillo`, la heurística
    original) — recolecta TODOS los contornos de cada una que pasen el filtro
    de área/aspect-ratio/piel (`_candidatos_validos`), descarta cualquiera
    que esté contenido dentro de otro candidato más grande
    (`_descartar_contenidos`, G4e) y se queda con el sobreviviente cuyo
    aspect ratio esté más cerca del ideal. Ninguna heurística clásica sola es
    invariante a fondo: brillo falla cuando carta y fondo tienen luminancia
    similar (funda oscura sobre tela oscura, aunque saturada); saturación en
    teoría podría fallar sobre un fondo ya acromático (mesa blanca/gris/negra
    lisa) donde carta y fondo comparten baja saturación — de ahí probar ambas
    en vez de reemplazar una por otra. Medido sobre el dataset real de 122
    fotos (ROADMAP.md G4b): brillo solo 30.3%, saturación sola 100%, así que
    en la práctica saturación domina en este dataset — pero mantener ambas
    como candidatos es más robusto a futuro que apostar todo a una sola
    heurística.

    También filtra candidatos mayormente color-piel Y sin estructura de
    carta (`_mascara_piel` + `_mapa_bordes`, ROADMAP.md G4e dirección (a)) —
    un rostro u otra piel expuesta a veces comparte el aspect ratio de una
    carta MTG por casualidad (hallazgo original de G4c). Esto es un filtro
    adicional, no un reemplazo del gate real de Stage 1 en
    `GuidedCapture.tsx`/`ListCard.tsx`, que sigue siendo la defensa
    principal (esta heurística geométrica no tiene ninguna noción de "esto
    es realmente una carta MTG", solo de "esto no parece piel real").

    También descarta candidatos demasiado grandes o demasiado uniformes
    (`img_gris`, `AREA_MAXIMA_FRACCION`/`CANDIDATO_TEXTURA_STD_MIN`) y
    penaliza (sin descartar) los que tocan el borde del frame
    (`PENALIZACION_BORDE`) — ROADMAP.md I32, ver los comentarios junto a esas
    constantes para el razonamiento y los números reales medidos contra el
    dataset de 122 fotos. Ataca el caso "una superficie de fondo uniforme
    (ej. un mousepad) se elige en vez de la carta", reportado en vivo por el
    usuario, distinto del caso de G4e (una sub-región interior de la carta
    misma comparte su aspect ratio).
    """
    h_img, w_img = img_bgr.shape[:2]
    area_img = h_img * w_img
    mascara_piel = _mascara_piel(img_bgr)
    mapa_bordes = _mapa_bordes(img_bgr)
    img_gris = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    candidatos = []
    for mascara in (_mascara_saturacion(img_bgr), _mascara_brillo(img_bgr)):
        candidatos.extend(_candidatos_validos(mascara, area_img, mascara_piel, mapa_bordes, img_gris))

    candidatos = _descartar_contenidos(candidatos)
    if not candidatos:
        return None

    mejor_contorno, mejor_rect, _, _ = min(candidatos, key=lambda c: c[2])
    return _ordenar_esquinas(_esquinas_desde_contorno(mejor_contorno, mejor_rect).astype("float32"))


def medir_desalineacion(esquinas: np.ndarray, umbral: float = DESALINEACION_RATIO_MIN) -> tuple[bool, float, float]:
    """Mide qué tan PARALELO está el teléfono al plano de la carta, POR EJE
    — ROADMAP.md I28b, ver el comentario junto a `DESALINEACION_RATIO_MIN`
    para el porqué esto reemplaza el enfoque original basado en gravedad, y
    por qué son dos ejes independientes y no un solo ratio combinado (pedido
    explícito del usuario: "8-12 grados en cada eje" — acá el equivalente
    real es cada eje evaluado por separado, no una fórmula de grados).

    Una carta rectangular fotografiada exactamente de frente proyecta lados
    opuestos de igual longitud (arriba≈abajo, izquierda≈derecha) sin
    importar el ángulo/rotación absoluto del plano. Cualquier desalineamiento
    teléfono-vs-carta produce keystone en uno o ambos ejes: los lados
    opuestos dejan de medir lo mismo (el lado más cerca de la cámara se ve
    más largo). `esquinas` debe venir en el orden que `_ordenar_esquinas()`
    produce (tl, tr, br, bl) — mismo formato que retorna `localizar_carta()`.

    Retorna (esta_desalineada, ratio_horizontal, ratio_vertical) — cada
    ratio es arriba/abajo o izquierda/derecha respectivamente (1.0 =
    perfectamente paralelo en ese eje, más bajo = más keystone en ese eje);
    `esta_desalineada` es True si CUALQUIERA de los dos ejes cae debajo de
    `umbral` — un solo eje mal alineado ya es señal suficiente, no hace
    falta que ambos lo estén."""
    tl, tr, br, bl = esquinas
    arriba = float(np.linalg.norm(tr - tl))
    abajo = float(np.linalg.norm(br - bl))
    izquierda = float(np.linalg.norm(bl - tl))
    derecha = float(np.linalg.norm(br - tr))
    ratio_horizontal = min(arriba, abajo) / max(arriba, abajo) if max(arriba, abajo) > 0 else 0.0
    ratio_vertical = min(izquierda, derecha) / max(izquierda, derecha) if max(izquierda, derecha) > 0 else 0.0
    desalineada = ratio_horizontal < umbral or ratio_vertical < umbral
    return desalineada, ratio_horizontal, ratio_vertical


def corregir_perspectiva(
    img_bgr: np.ndarray, esquinas: np.ndarray,
    ancho: int = ANCHO_CANONICO, alto: int = ALTO_CANONICO,
) -> np.ndarray:
    destino = np.array(
        [[0, 0], [ancho - 1, 0], [ancho - 1, alto - 1], [0, alto - 1]], dtype="float32"
    )
    M = cv2.getPerspectiveTransform(esquinas, destino)
    return cv2.warpPerspective(img_bgr, M, (ancho, alto))


def normalizar_carta(
    img_bgr: np.ndarray, ancho: int = ANCHO_CANONICO, alto: int = ALTO_CANONICO,
    intentar_localizar: bool = True,
) -> tuple[np.ndarray, bool]:
    """
    Localiza + corrige perspectiva de la carta en la foto. Si no se encuentra
    un contorno confiable, cae a redimensionar la imagen completa (asume que
    ya es la carta) — nunca retorna None, para no romper quien lo llama.

    `intentar_localizar=False` salta la detección directamente (fallback de
    una): usarlo cuando quien llama YA sabe que la imagen es un recorte
    ajustado (ej. renders de Scryfall, que van borde a borde sin fondo real).
    Probado en la práctica: sobre esas imágenes, la detección por contornos
    a veces engancha una sub-región interna de la carta (la caja de
    ilustración, que por casualidad comparte aspect ratio con la carta
    completa) en vez de fallar limpiamente a "no encontré nada" — ningún
    filtro de área/solidez/extent probado separaba estos falsos positivos de
    una detección real sobre una foto real sin también rechazar detecciones
    válidas. Es una limitación conocida de heurísticas clásicas (Canny/Otsu)
    de "document scanner": funcionan razonablemente bien cuando hay una
    foto real con fondo, no cuando no hay fondo que buscar. Quien llama es
    quien sabe cuál es su caso.

    Retorna (imagen_normalizada_BGR, se_detectó_un_contorno_de_carta).
    """
    esquinas = localizar_carta(img_bgr) if intentar_localizar else None
    if esquinas is not None:
        return corregir_perspectiva(img_bgr, esquinas, ancho, alto), True
    return cv2.resize(img_bgr, (ancho, alto), interpolation=cv2.INTER_AREA), False


def detectar_brillo_especular(
    img_bgr: np.ndarray,
    value_min: int = BRILLO_ESPECULAR_VALUE_MIN,
    sat_max: int = BRILLO_ESPECULAR_SAT_MAX,
    fraccion_aviso: float = BRILLO_ESPECULAR_FRACCION_AVISO,
) -> tuple[bool, float]:
    """Detecta reflejos de luz (glare) sobre `img_bgr` — pensado para
    correrse sobre la carta YA recortada/enderezada (`corregir_perspectiva`),
    no sobre la foto cruda con fondo. Un reflejo especular sobre plástico
    (funda transparente) se ve casi blanco puro y sin color: value muy alto
    + saturación muy baja al mismo tiempo, a diferencia del blanco "real" de
    la impresión (borde de la carta, cajas de texto) que normalmente tiene
    algo más de saturación o está rodeado de bordes/texto, no de un blob
    liso. Retorna (hay_brillo, fracción_del_área) — el booleano usa
    `fraccion_aviso` como umbral, pero la fracción cruda se retorna siempre
    por si quien llama quiere un umbral distinto sin recalcular.

    Umbrales de partida (`BRILLO_ESPECULAR_*`), NO medidos contra fotos
    reales con funda — el dataset de 122 fotos de G4b/G4c es sin funda. Sirve
    como primera aproximación server-side/client-side (misma lógica portada
    a `cardLocalizer.ts`) para avisarle al usuario en vivo ("mueve la carta,
    hay un reflejo") en vez de intentar corregir el reflejo algorítmicamente
    — inpainting de brillos especulares es su propio problema no trivial y
    no se intentó aquí.
    """
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    s = hsv[:, :, 1]
    v = hsv[:, :, 2]
    mascara = (v >= value_min) & (s <= sat_max)
    fraccion = float(np.count_nonzero(mascara)) / mascara.size
    return fraccion >= fraccion_aviso, fraccion


def detectar_funda_opaca(
    img_bgr: np.ndarray,
    edge_fraccion_max: float = FUNDA_OPACA_EDGE_FRACCION_MAX,
    std_max: float = FUNDA_OPACA_STD_MAX,
) -> tuple[bool, dict]:
    """Heurística de "no hay contenido de carta reconocible" — pensada para
    correrse antes de calificar condición (Stage 4) sobre la carta YA
    recortada/enderezada, como guard: si no hay ni bordes estructurales ni
    variación de color, no tiene sentido devolver un grado con confianza
    (una funda opaca, la parte de atrás de una funda de color, o una foto
    borrosa/mal encuadrada dan la misma señal — la etiqueta correcta para el
    usuario es "no puedo ver la carta", no un grado inventado).

    Retorna (es_sospechosa, detalle) — `detalle` trae `edge_fraccion` y
    `std` crudos por si quien llama quiere loguearlos o ajustar el umbral
    sin recalcular.
    """
    gris = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    bordes = cv2.Canny(gris, 50, 150)
    edge_fraccion = float(np.count_nonzero(bordes)) / bordes.size
    std = float(gris.std())
    sospechosa = edge_fraccion < edge_fraccion_max and std < std_max
    return sospechosa, {"edge_fraccion": edge_fraccion, "std": std}


def detectar_desenfoque(
    img_bgr: np.ndarray,
    var_min: float = DESENFOQUE_LAPLACIAN_VAR_MIN,
) -> tuple[bool, float]:
    """Detecta desenfoque (motion blur o foco mal ajustado) sobre `img_bgr` —
    pensado para correrse sobre la carta YA recortada/enderezada, igual que
    `detectar_brillo_especular`, y ANTES de gastar una llamada a Stage 1: una
    captura borrosa degrada la clasificación, la localización y sobre todo
    el OCR corriente abajo (`identifyCard.ts`), así que no vale la pena
    seguir con ella. Retorna (es_borrosa, varianza) — mismo shape que
    `detectar_brillo_especular`, la varianza cruda se retorna siempre por si
    quien llama quiere loguearla o ajustar el umbral sin recalcular.

    Umbral de partida (`DESENFOQUE_LAPLACIAN_VAR_MIN`), no medido contra un
    corpus real de fotos borrosas — ver el comentario junto a la constante.
    """
    gris = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    varianza = float(cv2.Laplacian(gris, cv2.CV_64F).var())
    return varianza < var_min, varianza


def mejorar_contraste(img_bgr: np.ndarray) -> np.ndarray:
    """CLAHE sobre el canal de luminancia (espacio Lab) — normaliza iluminación
    desigual sin lavar el color."""
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_norm = clahe.apply(l)
    return cv2.cvtColor(cv2.merge((l_norm, a, b)), cv2.COLOR_LAB2BGR)
