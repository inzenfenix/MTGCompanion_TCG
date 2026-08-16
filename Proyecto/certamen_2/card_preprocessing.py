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


def _ordenar_esquinas(pts: np.ndarray) -> np.ndarray:
    """Ordena 4 puntos como (top-left, top-right, bottom-right, bottom-left)."""
    suma = pts.sum(axis=1)
    diferencia = np.diff(pts, axis=1).reshape(-1)
    tl = pts[np.argmin(suma)]
    br = pts[np.argmax(suma)]
    tr = pts[np.argmin(diferencia)]
    bl = pts[np.argmax(diferencia)]
    return np.array([tl, tr, br, bl], dtype="float32")


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
    mascara = cv2.morphologyEx(mascara, cv2.MORPH_OPEN, np.ones((15, 15), np.uint8))
    mascara = cv2.morphologyEx(mascara, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    return mascara


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
    mascara = cv2.morphologyEx(mascara, cv2.MORPH_OPEN, np.ones((15, 15), np.uint8))
    mascara = cv2.morphologyEx(mascara, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    return mascara


def _candidatos_validos(mascara: np.ndarray, area_img: int) -> list[tuple[np.ndarray, float, float]]:
    """Todos los contornos de una máscara (no solo el más grande) que pasan
    los filtros de área/aspect-ratio, como (rect, score, area). `score` = qué
    tan cerca está el aspect ratio del ideal de una carta MTG (0 = match
    perfecto). Evaluar todos y no solo el más grande es lo que permite
    `_descartar_contenidos` detectar el caso "el contorno más grande de la
    máscara es en realidad una sub-región interior de la carta" — con un solo
    candidato por máscara no hay nada contra qué compararlo."""
    contornos, _ = cv2.findContours(mascara, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidatos = []
    for contorno in contornos:
        area = cv2.contourArea(contorno)
        if area < AREA_MINIMA_FRACCION * area_img:
            continue

        rect = cv2.minAreaRect(contorno)
        (_, _), (ancho, alto), _ = rect
        if ancho == 0 or alto == 0:
            continue

        ratio = min(ancho, alto) / max(ancho, alto)
        diff = abs(ratio - ASPECT_RATIO_CARTA)
        if diff > TOLERANCIA_ASPECT_RATIO:
            continue

        candidatos.append((rect, diff, area))
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
    candidatos: list[tuple[np.ndarray, float, float]],
) -> list[tuple[np.ndarray, float, float]]:
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
    for i, (rect_i, score_i, area_i) in enumerate(candidatos):
        puntos_i = cv2.boxPoints(rect_i)
        contenido = any(
            j != i and area_j > area_i and _rect_contenido(puntos_i, cv2.boxPoints(rect_j))
            for j, (rect_j, _, area_j) in enumerate(candidatos)
        )
        if not contenido:
            sobrevivientes.append((rect_i, score_i, area_i))
    return sobrevivientes


def localizar_carta(img_bgr: np.ndarray) -> np.ndarray | None:
    """
    Busca el rectángulo con aspect ratio de carta MTG en la foto. Retorna las
    4 esquinas ordenadas (float32) o None si no hay un candidato confiable
    (foto ya recortada, fondo sin contraste, ángulo extremo, etc.).

    Prueba dos estrategias de segmentación independientes — saturación
    (`_mascara_saturacion`) y brillo (`_mascara_brillo`, la heurística
    original) — recolecta TODOS los contornos de cada una que pasen el filtro
    de área/aspect-ratio (`_candidatos_validos`), descarta cualquiera que esté
    contenido dentro de otro candidato más grande (`_descartar_contenidos`,
    G4e) y se queda con el sobreviviente cuyo aspect ratio esté más cerca del
    ideal. Ninguna heurística clásica sola es invariante a fondo: brillo
    falla cuando carta y fondo tienen luminancia similar (funda oscura sobre
    tela oscura, aunque saturada); saturación en teoría podría fallar sobre
    un fondo ya acromático (mesa blanca/gris/negra lisa) donde carta y fondo
    comparten baja saturación — de ahí probar ambas en vez de reemplazar una
    por otra. Medido sobre el dataset real de 122 fotos (ROADMAP.md G4b):
    brillo solo 30.3%, saturación sola 100%, así que en la práctica
    saturación domina en este dataset — pero mantener ambas como candidatos
    es más robusto a futuro que apostar todo a una sola heurística.
    """
    h_img, w_img = img_bgr.shape[:2]
    area_img = h_img * w_img

    candidatos = []
    for mascara in (_mascara_saturacion(img_bgr), _mascara_brillo(img_bgr)):
        candidatos.extend(_candidatos_validos(mascara, area_img))

    candidatos = _descartar_contenidos(candidatos)
    if not candidatos:
        return None

    mejor_rect, _, _ = min(candidatos, key=lambda c: c[1])
    return _ordenar_esquinas(cv2.boxPoints(mejor_rect).astype("float32"))


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


def mejorar_contraste(img_bgr: np.ndarray) -> np.ndarray:
    """CLAHE sobre el canal de luminancia (espacio Lab) — normaliza iluminación
    desigual sin lavar el color."""
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_norm = clahe.apply(l)
    return cv2.cvtColor(cv2.merge((l_norm, a, b)), cv2.COLOR_LAB2BGR)
