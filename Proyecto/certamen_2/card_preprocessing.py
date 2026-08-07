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


def _ordenar_esquinas(pts: np.ndarray) -> np.ndarray:
    """Ordena 4 puntos como (top-left, top-right, bottom-right, bottom-left)."""
    suma = pts.sum(axis=1)
    diferencia = np.diff(pts, axis=1).reshape(-1)
    tl = pts[np.argmin(suma)]
    br = pts[np.argmax(suma)]
    tr = pts[np.argmin(diferencia)]
    bl = pts[np.argmax(diferencia)]
    return np.array([tl, tr, br, bl], dtype="float32")


def localizar_carta(img_bgr: np.ndarray) -> np.ndarray | None:
    """
    Busca el rectángulo más grande con aspect ratio de carta MTG en la foto.
    Retorna las 4 esquinas ordenadas (float32) o None si no hay un candidato
    confiable (foto ya recortada, fondo sin contraste, ángulo extremo, etc.).

    Segmentación por brillo (Otsu) + limpieza morfológica, no detección de
    bordes (Canny). Se probó Canny primero y falló en fotos reales: el borde
    de una funda oscura contra una mesa/tela oscura tiene muy poco contraste
    de luminancia, así que el borde de la carta casi no aparece en el mapa de
    edges, mientras que texturas brillantes del fondo generan ruido que
    domina como "contorno más grande". Otsu sobre brillo (carta más clara que
    el fondo) + apertura/cierre morfológico para limpiar ruido interno da un
    blob mucho más confiable de "toda la carta", incluso con contorno
    interno irregular — `minAreaRect` igual ajusta bien el rectángulo
    envolvente aunque el contorno no sea perfectamente limpio.
    """
    h_img, w_img = img_bgr.shape[:2]
    area_img = h_img * w_img

    gris = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gris, (9, 9), 0)
    _, mascara = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    mascara = cv2.morphologyEx(mascara, cv2.MORPH_OPEN, np.ones((15, 15), np.uint8))
    mascara = cv2.morphologyEx(mascara, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))

    contornos, _ = cv2.findContours(mascara, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contornos:
        return None

    candidato = max(contornos, key=cv2.contourArea)
    if cv2.contourArea(candidato) < AREA_MINIMA_FRACCION * area_img:
        return None

    (_, _), (ancho, alto), _ = rect = cv2.minAreaRect(candidato)
    if ancho == 0 or alto == 0:
        return None

    ratio = min(ancho, alto) / max(ancho, alto)
    if abs(ratio - ASPECT_RATIO_CARTA) > TOLERANCIA_ASPECT_RATIO:
        return None

    return _ordenar_esquinas(cv2.boxPoints(rect).astype("float32"))


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


def mejorar_contraste(img_bgr: np.ndarray) -> np.ndarray:
    """CLAHE sobre el canal de luminancia (espacio Lab) — normaliza iluminación
    desigual sin lavar el color."""
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_norm = clahe.apply(l)
    return cv2.cvtColor(cv2.merge((l_norm, a, b)), cv2.COLOR_LAB2BGR)
