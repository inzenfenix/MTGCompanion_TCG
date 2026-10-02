"""
MTG Card Scanner — Certamen 2
prepare_text_validator_dataset.py: genera el dataset de pares (Stage 2).

Mismo criterio que prepare_condition_dataset.py para Stage 4: separa el paso
lento/de I/O (descargar en calidad "large" + correr OCR con tesseract, ver
text_validator_baseline.py) de las corridas de entrenamiento en sí — así
pytorch/14_text_validator.py y tensorFlow/12_text_validator.py entrenan sobre
exactamente el mismo dataset fijo en vez de correr el pipeline de OCR (lento)
cada vez que se itera arquitectura/hiperparámetros, y ambos frameworks se
comparan sobre datos idénticos.

Reusa las funciones de text_validator_baseline.py (recorte + OCR + texto de
referencia) en vez de duplicarlas — este script es solo la envoltura que arma
pares (ocr_text, texto_referencia, label) y los vuelca a un CSV, igual que
prepare_condition_dataset.py arma su index.csv.

Por carta: un par positivo (contra su propia carta) y un par negativo (contra
otra carta al azar del batch) — mismo balance 1:1 que ya usaba el baseline al
medir ROC-AUC.

Uso:
    python prepare_text_validator_dataset.py                # 800 cartas de muestra
    python prepare_text_validator_dataset.py --n 200          # muestra chica, iterar rápido
"""

import argparse
import csv
import json
import pathlib
import random
import sys

import requests

from text_validator_baseline import (
    CARDS_JSON,
    OCR_IMAGES_DIR,
    SEED,
    asegurar_tessdata,
    descargar_imagen,
    ocr_texto,
    recortar_texto,
    texto_referencia,
)

CERTAMEN2_DIR = pathlib.Path(__file__).resolve().parent
PAIRS_DIR = CERTAMEN2_DIR / "data" / "text_pairs"  # gitignored, igual que condition_dataset/


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera el dataset de pares OCR/texto-de-referencia para Stage 2.")
    parser.add_argument("--n", type=int, default=800, help="Cantidad de cartas a muestrear (default: 800)")
    parser.add_argument("--quality", default="large", choices=["normal", "large", "png"],
                         help="Calidad de descarga para OCR (small es ilegible). default: large")
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()

    asegurar_tessdata()

    if not CARDS_JSON.exists():
        print(f"Error: no existe {CARDS_JSON}. Corré certamen_1/01_scraper.py primero.")
        sys.exit(1)

    with open(CARDS_JSON, encoding="utf-8") as f:
        cards = json.load(f)

    candidatas = [c for c in cards if c.get("image_url") and (c.get("name") or c.get("oracle_text"))]
    print(f"Cartas con imagen + texto de referencia disponible : {len(candidatas):,}")

    rng = random.Random(args.seed)
    muestra = rng.sample(candidatas, min(args.n, len(candidatas)))
    print(f"Muestra                                             : {len(muestra):,}  (calidad de descarga: {args.quality})")

    OCR_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    PAIRS_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()

    filas = []
    ok, saltadas = 0, 0

    for i, card in enumerate(muestra):
        ruta = descargar_imagen(card, args.quality, session)
        if ruta is None:
            saltadas += 1
            continue

        recorte = recortar_texto(ruta)
        if recorte is None:
            saltadas += 1
            continue

        texto_ocr = ocr_texto(recorte)
        if not texto_ocr.strip():
            saltadas += 1
            continue

        otra = rng.choice([c for c in muestra if c["id"] != card["id"]])

        filas.append({
            "card_id": card["id"], "other_card_id": card["id"],
            "ocr_text": texto_ocr, "ref_text": texto_referencia(card), "label": 1,
        })
        filas.append({
            "card_id": card["id"], "other_card_id": otra["id"],
            "ocr_text": texto_ocr, "ref_text": texto_referencia(otra), "label": 0,
        })

        ok += 1
        if (i + 1) % 100 == 0:
            print(f"  {i + 1}/{len(muestra)} procesadas...")

    if not filas:
        print("Error: no se generó ningún par (¿fallaron todas las descargas/OCR?).")
        sys.exit(1)

    index_path = PAIRS_DIR / "index.csv"
    with open(index_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["card_id", "other_card_id", "ocr_text", "ref_text", "label"])
        writer.writeheader()
        writer.writerows(filas)

    print(f"\nCartas procesadas: {ok:,}  |  saltadas (descarga/OCR falló o vino vacío): {saltadas:,}")
    print(f"Total de pares    : {len(filas):,}  ({ok:,} × 2, balanceado 1 positivo / 1 negativo)")
    print(f"Dataset: {OCR_IMAGES_DIR}")
    print(f"Índice : {index_path}")


if __name__ == "__main__":
    main()
