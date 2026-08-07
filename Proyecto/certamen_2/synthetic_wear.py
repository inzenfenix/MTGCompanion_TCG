"""
MTG Card Scanner — Certamen 2
synthetic_wear.py: simula desgaste físico sobre renders limpios con OpenCV.

Bootstrap de datos para Stage 4 (clasificador de condición, ver README.md
sección 9) mientras se consiguen/verifican los datasets reales (Roboflow).
No reemplaza fotos reales de cartas desgastadas — las complementa: volumen
ilimitado, cero riesgo de derechos (son los mismos renders de Scryfall que
ya usa el resto del proyecto), pero el desgaste es simulado, no fotografiado
— un clasificador entrenado solo con esto probablemente no generalice del
todo a fotos reales, por eso sigue siendo complemento, no reemplazo.

Grados soportados (mismos que CONDITION_MULTIPLIERS en price_estimator_baseline.py):
    NM  (near mint)          — sin desgaste, la carta tal cual.
    LP  (lightly played)     — whitening leve de bordes, 1 scratch fino.
    MP  (moderately played)  — whitening + varios scratches, esquinas algo redondeadas.
    HP  (heavily played)     — whitening fuerte, muchos scratches, esquinas redondeadas, crease leve.
    DMG (damaged)            — todo lo anterior más marcado, crease fuerte, manchas.

Los parámetros de intensidad por grado son manuales, no aprendidos — el
objetivo es dar separación visual suficiente entre grados para que un
clasificador tenga señal, no replicar un estándar de grading profesional
(PSA/BGS) con precisión.

Uso:
    from synthetic_wear import aplicar_desgaste
    carta_desgastada = aplicar_desgaste(carta_bgr, grado="MP", seed=42)

Standalone (genera un grid NM..DMG de una carta para inspección visual):
    python synthetic_wear.py --carta ejemplo.jpg
"""

from __future__ import annotations

import argparse
import random

import cv2
import numpy as np

GRADOS = ["NM", "LP", "MP", "HP", "DMG"]

_PARAMS = {
    "NM":  dict(whitening=0.00, n_scratches=0, corner_round=0,  crease=0.0, mancha=0.0),
    "LP":  dict(whitening=0.15, n_scratches=1, corner_round=2,  crease=0.0, mancha=0.0),
    "MP":  dict(whitening=0.35, n_scratches=3, corner_round=6,  crease=0.3, mancha=0.15),
    "HP":  dict(whitening=0.55, n_scratches=5, corner_round=10, crease=0.6, mancha=0.30),
    "DMG": dict(whitening=0.75, n_scratches=8, corner_round=16, crease=0.9, mancha=0.50),
}


def _whitening_bordes(img: np.ndarray, intensidad: float, rng: random.Random) -> np.ndarray:
    """Aclara una franja irregular en el borde de la carta (cartboard blanco asomando por uso)."""
    if intensidad <= 0:
        return img
    h, w = img.shape[:2]
    grosor = max(1, int(min(h, w) * 0.02 * intensidad * 3))

    marco = np.zeros((h, w), dtype=np.uint8)
    cv2.rectangle(marco, (0, 0), (w - 1, h - 1), 255, thickness=grosor)

    ruido_gen = np.random.default_rng(rng.randint(0, 1_000_000))
    ruido = (ruido_gen.random((h, w)) < (0.4 + intensidad * 0.4)).astype(np.uint8) * 255
    mask = cv2.bitwise_and(marco, ruido)
    mask = cv2.GaussianBlur(mask, (5, 5), 0)

    blanco = np.full_like(img, 235)
    alpha = (mask.astype(np.float32) / 255.0 * intensidad)[..., None]
    return (img.astype(np.float32) * (1 - alpha) + blanco.astype(np.float32) * alpha).astype(np.uint8)


def _scratches(img: np.ndarray, n: int, rng: random.Random) -> np.ndarray:
    """Líneas finas semi-transparentes simulando rayones superficiales."""
    if n <= 0:
        return img
    h, w = img.shape[:2]
    overlay = img.copy()
    for _ in range(n):
        x1, y1 = rng.randint(0, w - 1), rng.randint(0, h - 1)
        largo = rng.randint(int(0.1 * w), int(0.4 * w))
        angulo = rng.uniform(0, 2 * np.pi)
        x2 = int(x1 + largo * np.cos(angulo))
        y2 = int(y1 + largo * np.sin(angulo))
        color = rng.choice([(230, 230, 230), (200, 200, 200)])
        cv2.line(overlay, (x1, y1), (x2, y2), color, thickness=rng.choice([1, 1, 2]), lineType=cv2.LINE_AA)
    return cv2.addWeighted(overlay, 0.35, img, 0.65, 0)


def _redondear_esquinas(img: np.ndarray, radio: int) -> np.ndarray:
    """Redondea las esquinas de la carta (desgaste típico de manipulación repetida)."""
    if radio <= 0:
        return img
    h, w = img.shape[:2]
    mask = np.full((h, w), 255, dtype=np.uint8)
    for cx, cy in [(0, 0), (w, 0), (0, h), (w, h)]:
        cv2.circle(mask, (cx, cy), radio, 0, -1)
    mask = cv2.GaussianBlur(mask, (5, 5), 0)

    fondo = np.full_like(img, 245)
    alpha = ((255 - mask).astype(np.float32) / 255.0)[..., None]
    return (img.astype(np.float32) * (1 - alpha) + fondo.astype(np.float32) * alpha).astype(np.uint8)


def _crease(img: np.ndarray, intensidad: float, rng: random.Random) -> np.ndarray:
    """Simula un doblez: banda de sombra diagonal cruzando la carta."""
    if intensidad <= 0:
        return img
    h, w = img.shape[:2]
    x0 = rng.randint(0, w)
    angulo = rng.uniform(-0.3, 0.3)
    grosor = max(2, int(0.01 * w))

    linea = np.zeros((h, w), dtype=np.float32)
    x1 = int(x0 + h * np.tan(angulo))
    cv2.line(linea, (x0, 0), (x1, h), 1.0, thickness=grosor, lineType=cv2.LINE_AA)
    linea = cv2.GaussianBlur(linea, (0, 0), sigmaX=grosor * 1.5)

    sombra = (linea * intensidad * 60)[..., None]
    return np.clip(img.astype(np.float32) - sombra, 0, 255).astype(np.uint8)


def _mancha(img: np.ndarray, intensidad: float, rng: random.Random) -> np.ndarray:
    """Mancha/smudge circular semi-transparente."""
    if intensidad <= 0:
        return img
    h, w = img.shape[:2]
    overlay = img.copy()
    for _ in range(rng.randint(1, 2)):
        cx, cy = rng.randint(0, w), rng.randint(0, h)
        r = rng.randint(int(0.03 * w), int(0.08 * w))
        cv2.circle(overlay, (cx, cy), r, (160, 160, 170), -1, lineType=cv2.LINE_AA)
    overlay = cv2.GaussianBlur(overlay, (15, 15), 0)
    return cv2.addWeighted(overlay, intensidad * 0.4, img, 1 - intensidad * 0.4, 0)


def aplicar_desgaste(img_bgr: np.ndarray, grado: str, seed: int | None = None) -> np.ndarray:
    """Aplica desgaste sintético de un grado (NM/LP/MP/HP/DMG) sobre una carta ya normalizada."""
    if grado not in _PARAMS:
        raise ValueError(f"Grado desconocido: {grado!r}. Opciones: {GRADOS}")
    rng = random.Random(seed)
    p = _PARAMS[grado]

    out = img_bgr.copy()
    out = _whitening_bordes(out, p["whitening"], rng)
    out = _scratches(out, p["n_scratches"], rng)
    out = _redondear_esquinas(out, p["corner_round"])
    out = _crease(out, p["crease"], rng)
    out = _mancha(out, p["mancha"], rng)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera un grid NM..DMG de desgaste sintético sobre una carta.")
    parser.add_argument("--carta", required=True, help="Ruta a una imagen de carta (idealmente ya normalizada).")
    parser.add_argument("--salida", default="/tmp/synthetic_wear_grid.jpg")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    img = cv2.imread(args.carta)
    if img is None:
        raise SystemExit(f"No se pudo leer {args.carta}")
    img = cv2.resize(img, (375, 525))

    celdas = [aplicar_desgaste(img, g, seed=args.seed) for g in GRADOS]
    fila = np.hstack(celdas)
    for i, g in enumerate(GRADOS):
        cv2.putText(fila, g, (i * 375 + 10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2, cv2.LINE_AA)
    cv2.imwrite(args.salida, fila)
    print(f"Grid guardado en {args.salida}")


if __name__ == "__main__":
    main()
