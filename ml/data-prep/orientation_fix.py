"""
MTG Card Scanner — Certamen 2
orientation_fix.py: corrige la orientación (0/90/180/270°) de una carta ya
localizada/enderezada por card_preprocessing.normalizar_carta().

Por qué es un módulo aparte y no una función más de card_preprocessing.py:
ese módulo es la referencia que se va a portar a OpenCV.js del lado de la
app Ionic (ver su docstring) — mantenerlo sin dependencias de tesseract lo
deja portable. Esto en cambio SÍ depende de pytesseract (ya una dependencia
del proyecto para Stage 2, ver text_validator_baseline.py) y solo tiene
sentido correrlo server/Python-side (o eventualmente con tesseract.js en el
navegador — ver ROADMAP.md E3).

Por qué hace falta además de normalizar_carta(): esa función endereza el
CUADRILÁTERO de la carta (perspectiva correcta), pero es puramente
geométrica — no tiene forma de saber cuál de las 4 esquinas es "arriba" si
la carta física fue fotografiada boca abajo o de costado. El resultado es
geométricamente una carta perfecta, pero el contenido (texto, arte) puede
quedar rotado 90/180/270° respecto a como se lee normalmente. Confirmado
sobre el dataset real (ROADMAP.md G4b): ~32% de las 122 fotos reales salen
rotadas (180° en su mayoría, algo de 90/270°) tras normalizar_carta().

Estrategia: `pytesseract.image_to_osd()` (Orientation and Script Detection,
un modelo de tesseract aparte del de OCR normal) sobre la caja de texto de
reglas ya recortada — probado que corre sobre la carta completa casi
siempre falla ("too few characters", la ilustración diluye la densidad de
texto), pero sobre el recorte de texto (mismo CROP_TEXTO que usa
text_validator_baseline.py) funciona razonablemente bien. Cuando OSD no
puede determinar la orientación (carta con poco texto — tierras básicas,
por ejemplo) se deja la imagen sin tocar: mismo patrón de "nunca rompe al
que llama" que normalizar_carta().
"""

from __future__ import annotations

import os
import pathlib

import cv2
import numpy as np
import pytesseract
import requests

DATA_PREP_DIR = pathlib.Path(__file__).resolve().parent
_TESSDATA_LOCAL = DATA_PREP_DIR / ".tessdata"

_ROTACIONES = {
    90: cv2.ROTATE_90_CLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_COUNTERCLOCKWISE,
}


def asegurar_osd_tessdata() -> pathlib.Path:
    """
    Se asegura de que `osd.traineddata` (el modelo de detección de
    orientación, distinto del paquete de idioma `eng`) esté disponible, y
    retorna el directorio tessdata a usar. La instalación de sistema de
    tesseract en esta máquina solo trae `eng` (confirmado — `tesseract
    --list-langs`), así que hace falta el mismo fallback de descarga local
    que `text_validator_baseline.asegurar_tessdata()` ya usa para `eng`.

    No toca `TESSDATA_PREFIX` global — se pasa `--tessdata-dir` por llamada
    (vía `corregir_orientacion`) para no interferir con el OCR normal
    (`pytesseract.image_to_string(lang="eng")`), que ya funciona con el
    tessdata de sistema.
    """
    osd_local = _TESSDATA_LOCAL / "osd.traineddata"
    if not osd_local.exists():
        print("Paquete OSD de tesseract no encontrado — descargando copia local (~11 MB, una vez)...")
        _TESSDATA_LOCAL.mkdir(exist_ok=True)
        url = "https://github.com/tesseract-ocr/tessdata_fast/raw/main/osd.traineddata"
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        osd_local.write_bytes(resp.content)
    return _TESSDATA_LOCAL


def corregir_orientacion(carta_bgr: np.ndarray, recorte_texto: np.ndarray) -> tuple[np.ndarray, int]:
    """
    Detecta y corrige la orientación de `carta_bgr` (la carta ya
    localizada/enderezada por normalizar_carta, tamaño canónico completo)
    usando OSD sobre `recorte_texto` (el recorte de la caja de texto de
    reglas de esa misma carta, ya en escala de grises/upscaled — mismo
    recorte que consume `ocr_texto()` en text_validator_baseline.py, para no
    correr el recorte dos veces).

    Retorna (carta_corregida, grados_rotados). grados_rotados es 0 si OSD no
    pudo determinar la orientación con confianza (muy poco texto — tierras
    básicas, cartas muy borrosas) o si ya estaba correcta.
    """
    tessdata_dir = asegurar_osd_tessdata()
    try:
        osd = pytesseract.image_to_osd(
            recorte_texto, config=f'--tessdata-dir "{tessdata_dir}"', output_type=pytesseract.Output.DICT,
        )
    except Exception:
        return carta_bgr, 0  # muy poco texto para que OSD determine la orientación — no tocar la imagen

    rotar = osd.get("rotate", 0)
    flag = _ROTACIONES.get(rotar)
    if flag is None:
        return carta_bgr, 0

    return cv2.rotate(carta_bgr, flag), rotar
