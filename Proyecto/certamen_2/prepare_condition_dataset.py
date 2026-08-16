"""
MTG Card Scanner — Certamen 2
prepare_condition_dataset.py: genera el dataset sintético de condición (Stage 4).

Bootstrap de datos mientras se consiguen/verifican los datasets reales de
Roboflow (ver README.md, sección 9). Para cada carta muestreada, genera una
versión por grado (NM/LP/MP/HP/DMG) con synthetic_wear.py, todas a partir de
la misma imagen limpia — el dataset resultante queda balanceado por
construcción (mismo N de cartas en cada grado).

No reemplaza fotos reales — es para tener algo entrenable hoy y medir si el
enfoque (transfer learning sobre el mismo backbone que las otras etapas)
funciona en absoluto, antes de invertir en conseguir/etiquetar fotos reales.

`--con-fundas` (opt-in, default apagado para no romper la reproducibilidad
de corridas existentes) agrega, por cada imagen grado×carta ya generada, dos
variantes más pasadas por `synthetic_sleeve.py` (`clear` y `colored`) — ver
ROADMAP.md G4e (follow-up de fundas). Casi ningún usuario real escanea una
carta desnuda; sin esto el dataset de Stage 4 nunca vio un ejemplo enfundado.
Triplica el volumen generado (mismo card_id, sigue agrupado correctamente
por `split_por_carta()` en el training script — no es una fuga nueva).

Uso:
    python prepare_condition_dataset.py                # 500 cartas de muestra
    python prepare_condition_dataset.py --n 100          # muestra chica, iterar rápido
    python prepare_condition_dataset.py --con-fundas     # + variantes clear/colored por imagen
"""

import argparse
import csv
import json
import pathlib
import random
import re
import sys
import time

import cv2
import requests

from card_preprocessing import normalizar_carta
from synthetic_sleeve import TIPOS as TIPOS_FUNDA, aplicar_funda
from synthetic_wear import aplicar_desgaste, GRADOS

CERTAMEN2_DIR = pathlib.Path(__file__).resolve().parent
CARDS_JSON = CERTAMEN2_DIR.parent / "certamen_1" / "data" / "cards.json"
FUENTE_IMAGENES_DIR = CERTAMEN2_DIR / "data" / "ocr_images"  # reusa el cache de text_validator_baseline.py (calidad "large")
DATASET_DIR = CERTAMEN2_DIR / "data" / "condition_dataset"    # gitignored

HEADERS = {"User-Agent": "MTG-Scanner-Academic/1.0"}
SEED = 42


def url_calidad(image_url: str, calidad: str) -> str:
    return re.sub(r"/(small|normal|large|png)/", f"/{calidad}/", image_url, count=1)


def descargar_si_falta(card: dict, session: requests.Session) -> pathlib.Path | None:
    ruta = FUENTE_IMAGENES_DIR / f"{card['id']}.jpg"
    if ruta.exists():
        return ruta
    try:
        resp = session.get(url_calidad(card["image_url"], "large"), headers=HEADERS, timeout=30)
        resp.raise_for_status()
        FUENTE_IMAGENES_DIR.mkdir(parents=True, exist_ok=True)
        ruta.write_bytes(resp.content)
        time.sleep(0.06)
        return ruta
    except requests.RequestException as e:
        print(f"  aviso: no se pudo descargar {card['id']}: {e}")
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera el dataset sintético NM/LP/MP/HP/DMG para Stage 4.")
    parser.add_argument("--n", type=int, default=500, help="Cantidad de cartas base a muestrear (default: 500)")
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument(
        "--con-fundas", action="store_true",
        help="Agrega variantes clear/colored (synthetic_sleeve.py) por cada imagen grado×carta (ROADMAP G4e).",
    )
    args = parser.parse_args()

    if not CARDS_JSON.exists():
        print(f"Error: no existe {CARDS_JSON}. Corré certamen_1/01_scraper.py primero.")
        sys.exit(1)

    with open(CARDS_JSON, encoding="utf-8") as f:
        cards = json.load(f)
    candidatas = [c for c in cards if c.get("image_url")]

    variantes_funda = ["ninguna"] + TIPOS_FUNDA if args.con_fundas else ["ninguna"]
    rng = random.Random(args.seed)
    muestra = rng.sample(candidatas, min(args.n, len(candidatas)))
    print(
        f"Cartas base: {len(muestra):,}  ×  {len(GRADOS)} grados"
        + (f"  ×  {len(variantes_funda)} variantes de funda" if args.con_fundas else "")
        + f" = {len(muestra) * len(GRADOS) * len(variantes_funda):,} imágenes"
    )

    session = requests.Session()
    for grado in GRADOS:
        (DATASET_DIR / grado).mkdir(parents=True, exist_ok=True)

    filas_index = []
    ok, saltadas = 0, 0

    for i, card in enumerate(muestra):
        ruta_fuente = descargar_si_falta(card, session)
        if ruta_fuente is None:
            saltadas += 1
            continue

        img = cv2.imread(str(ruta_fuente))
        if img is None:
            saltadas += 1
            continue

        # Los renders de Scryfall ya vienen recortados borde a borde — no
        # localizar (ver card_preprocessing.py y README sección 8 sobre por
        # qué la detección de contornos no es confiable en estas imágenes).
        carta, _ = normalizar_carta(img, intentar_localizar=False)

        for grado in GRADOS:
            seed_variante = hash((card["id"], grado)) % (2**31)
            desgastada = aplicar_desgaste(carta, grado, seed=seed_variante)

            for funda in variantes_funda:
                if funda == "ninguna":
                    final = desgastada
                    sufijo = ""
                else:
                    seed_funda = hash((card["id"], grado, funda)) % (2**31)
                    final = aplicar_funda(desgastada, tipo=funda, seed=seed_funda)
                    sufijo = f"_{funda}"
                destino = DATASET_DIR / grado / f"{card['id']}{sufijo}.jpg"
                cv2.imwrite(str(destino), final)
                filas_index.append({
                    "card_id": card["id"], "name": card["name"], "grado": grado, "funda": funda, "path": str(destino),
                })

        ok += 1
        if (i + 1) % 100 == 0:
            print(f"  {i + 1}/{len(muestra)} cartas procesadas...")

    index_path = DATASET_DIR / "index.csv"
    with open(index_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["card_id", "name", "grado", "funda", "path"])
        writer.writeheader()
        writer.writerows(filas_index)

    print(f"\nCartas procesadas: {ok:,}  |  saltadas: {saltadas:,}")
    print(f"Total de imágenes generadas: {len(filas_index):,}  ({ok:,} × {len(GRADOS)} grados × {len(variantes_funda)} variantes de funda)")
    print(f"Dataset: {DATASET_DIR}")
    print(f"Índice : {index_path}")


if __name__ == "__main__":
    main()
