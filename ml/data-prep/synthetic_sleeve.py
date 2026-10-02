"""
MTG Card Scanner — Certamen 2
synthetic_sleeve.py: simula el efecto de una funda de plástico sobre una
carta ya normalizada, con OpenCV — mismo propósito que synthetic_wear.py
(bootstrap de datos de entrenamiento mientras no hay volumen suficiente de
fotos reales) pero para un factor de dominio distinto: la mayoría de los
usuarios reales escanean cartas ENFUNDADAS, no desnudas, y ninguna etapa
(Stage 1 embedding, Stage 2 OCR, Stage 4 condición) vio jamás un ejemplo
enfundado durante entrenamiento — ver ROADMAP.md G4e (follow-up de fundas,
levantado junto con el fix de contención de contornos) para el contexto
completo de por qué esto importa.

Alcance deliberadamente limitado a fundas TRANSPARENTES (con o sin borde de
color) — el bolsillo frontal de una funda es transparente por diseño (si no,
no se podría leer/jugar la carta), así que es el caso real que hay que
enseñarle al modelo a tolerar. Una funda OPACA (o el reverso de una funda de
color mirando a la cámara) no es un caso de "carta con ruido visual", es un
caso de "no hay carta visible" — ningún volumen de datos sintéticos arregla
eso. Ese caso se maneja aparte como guard de UX (detectar y avisar "sácala de
la funda" en vez de intentar identificarla) — no se simula acá.

Efectos simulados, cada uno con motivación física real:
    - brillo especular: 1-2 manchas elípticas sobreexpuestas (reflejo de luz
      sobre el plástico) — mismo fenómeno que
      `card_preprocessing.py::detectar_brillo_especular()` está pensado para
      DETECTAR en vivo durante la captura; acá se GENERA, para que el modelo
      además vea ejemplos afectados durante entrenamiento en vez de depender
      solo del aviso al usuario.
    - tinte de color: overlay translúcido uniforme leve (el plástico "clear"
      rara vez es 100% neutro).
    - borde de color: anillo translúcido en el margen (fundas "matte"/de
      color casi siempre muestran borde incluso con bolsillo frontal
      transparente).
    - suavizado óptico: blur gaussiano leve (la carta se ve un poco menos
      nítida a través de una capa extra de plástico).

Uso:
    from synthetic_sleeve import aplicar_funda
    enfundada = aplicar_funda(carta_bgr, tipo="colored", seed=42)

Standalone (grid sin funda / clear / colored de una carta, para inspección visual):
    python synthetic_sleeve.py --carta ejemplo.jpg
"""

from __future__ import annotations

import argparse
import random

import cv2
import numpy as np

TIPOS = ["clear", "colored"]

# Colores de funda comunes (BGR) para el tinte y, en modo "colored", el
# borde — elegidos al azar por muestra si no se especifica uno.
_COLORES_FUNDA = [
    (40, 40, 40),     # negro
    (210, 210, 205),  # blanco/plata
    (60, 40, 180),    # rojo
    (150, 40, 40),    # azul
    (40, 130, 40),    # verde
]


def _brillo_especular(img: np.ndarray, n: int, intensidad: float, rng: random.Random) -> np.ndarray:
    """Manchas elípticas sobreexpuestas simulando un reflejo de luz sobre el plástico."""
    if n <= 0 or intensidad <= 0:
        return img
    h, w = img.shape[:2]
    overlay = img.copy()
    for _ in range(n):
        cx, cy = rng.randint(0, w), rng.randint(0, h)
        ejes = (rng.randint(int(0.05 * w), int(0.18 * w)), rng.randint(int(0.03 * h), int(0.10 * h)))
        angulo = rng.uniform(0, 180)
        cv2.ellipse(overlay, (cx, cy), ejes, angulo, 0, 360, (250, 250, 250), -1, lineType=cv2.LINE_AA)
    overlay = cv2.GaussianBlur(overlay, (25, 25), 0)
    return cv2.addWeighted(overlay, intensidad, img, 1 - intensidad, 0)


def _tinte(img: np.ndarray, color: tuple[int, int, int], intensidad: float) -> np.ndarray:
    """Overlay translúcido uniforme — el plástico "transparente" rara vez es 100% neutro."""
    if intensidad <= 0:
        return img
    capa = np.full_like(img, color)
    return cv2.addWeighted(capa, intensidad, img, 1 - intensidad, 0)


def _borde(img: np.ndarray, color: tuple[int, int, int], grosor_frac: float, intensidad: float) -> np.ndarray:
    """Anillo de color translúcido en el margen — borde visible de fundas "matte"/de color."""
    if intensidad <= 0 or grosor_frac <= 0:
        return img
    h, w = img.shape[:2]
    grosor = max(1, int(min(h, w) * grosor_frac))
    marco = img.copy()
    cv2.rectangle(marco, (0, 0), (w - 1, h - 1), color, thickness=grosor)
    return cv2.addWeighted(marco, intensidad, img, 1 - intensidad, 0)


def _suavizado(img: np.ndarray, intensidad: float) -> np.ndarray:
    """Blur gaussiano leve — capa extra de plástico entre la carta y la cámara."""
    if intensidad <= 0:
        return img
    k = 3 if intensidad < 0.6 else 5
    borroso = cv2.GaussianBlur(img, (k, k), 0)
    return cv2.addWeighted(borroso, intensidad, img, 1 - intensidad, 0)


def aplicar_funda(
    img_bgr: np.ndarray,
    tipo: str = "clear",
    seed: int | None = None,
    color: tuple[int, int, int] | None = None,
) -> np.ndarray:
    """Aplica el efecto de una funda de plástico transparente (con o sin
    borde de color) sobre una carta ya normalizada.

    `tipo`:
        "clear"   — brillo especular + tinte leve + suavizado, sin borde
                    (funda "Clear"/perfect-fit).
        "colored" — igual que "clear" más un anillo de color en el margen
                    (funda "Matte"/de color).

    Randomiza intensidad/posición de cada efecto vía `seed` (reproducible,
    mismo patrón que `synthetic_wear.aplicar_desgaste`) — no son valores
    fijos por tipo como en `synthetic_wear._PARAMS`, porque acá lo que varía
    entre fundas reales es sobre todo posición del brillo y color/intensidad
    del tinte/borde, no "niveles de severidad" discretos.
    """
    if tipo not in TIPOS:
        raise ValueError(f"Tipo de funda desconocido: {tipo!r}. Opciones: {TIPOS}")
    rng = random.Random(seed)

    out = img_bgr.copy()
    out = _brillo_especular(out, n=rng.randint(0, 2), intensidad=rng.uniform(0.15, 0.45), rng=rng)
    out = _tinte(out, color=rng.choice(_COLORES_FUNDA), intensidad=rng.uniform(0.02, 0.08))
    out = _suavizado(out, intensidad=rng.uniform(0.1, 0.4))
    if tipo == "colored":
        color_borde = color or rng.choice(_COLORES_FUNDA)
        out = _borde(out, color=color_borde, grosor_frac=rng.uniform(0.015, 0.035), intensidad=rng.uniform(0.5, 0.85))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera un grid sin funda / clear / colored de una carta.")
    parser.add_argument("--carta", required=True, help="Ruta a una imagen de carta (idealmente ya normalizada).")
    parser.add_argument("--salida", default="/tmp/synthetic_sleeve_grid.jpg")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    img = cv2.imread(args.carta)
    if img is None:
        raise SystemExit(f"No se pudo leer {args.carta}")
    img = cv2.resize(img, (375, 525))

    etiquetas = ["sin funda", "clear", "colored"]
    celdas = [img.copy(), aplicar_funda(img, "clear", seed=args.seed), aplicar_funda(img, "colored", seed=args.seed)]
    fila = np.hstack(celdas)
    for i, etiqueta in enumerate(etiquetas):
        cv2.putText(fila, etiqueta, (i * 375 + 10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2, cv2.LINE_AA)
    cv2.imwrite(args.salida, fila)
    print(f"Grid guardado en {args.salida}")


if __name__ == "__main__":
    main()
