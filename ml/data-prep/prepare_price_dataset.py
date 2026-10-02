"""
MTG Card Scanner — Certamen 2
prepare_price_dataset.py: arma la mitad tabular + el split + el escalador
del dataset de Stage 3 "de verdad" (ver README.md, sección 5.1.1).

Mismo criterio que prepare_text_validator_dataset.py / prepare_condition_dataset.py:
separa el paso de I/O (leer cards.json, filtrar por precio válido) de las
corridas de entrenamiento en sí. A diferencia de esos dos, este script NO
toca imágenes ni ningún backbone — esa parte (el embedding visual congelado
de Stage 1, que sí necesita torch o tensorflow cargados) vive en
pytorch/prepare_price_embeddings.py y tensorFlow/prepare_price_embeddings.py,
cada uno corriendo en el venv de su propio framework, para no tener que
instalar torch NI tensorflow en el venv liviano de certamen_2 (ver
requirements.txt). Este script sí puede importar src/price_features.py
(cualquiera de las dos copias, son byte-idénticas) porque ese módulo es
Python puro — solo agrega pytorch/ a sys.path.

Salidas, todas bajo data/price_dataset/ (gitignored):
  - cards.csv          : una fila por carta con precio usable, campos crudos
                          de src/price_features.py::raw_card_fields() + usd.
  - split.json          : partición fija train/val/test por card_id (seed
                          fija) — compartida por los dos frameworks, para que
                          entrenen/evalúen sobre exactamente las mismas
                          cartas (más fuerte que un train_test_split
                          independiente por script).
  - tabular_scaler.json : media/desvío de los 6 campos numéricos sin acotar
                          (NUMERIC_FIELDS, incluye edhrec_rank_log desde
                          ROADMAP.md B6), calculados SOLO sobre el split de
                          train — no un StandardScaler pickleado (no portable
                          entre venvs de dos lenguajes, tampoco exportable a
                          ONNX), solo los números.

Además, si se corre con el dataset completo (sin --n), publica
tabular_scaler.json en apps/mobile/public/models/stage3-tabular-scaler.json
(ROADMAP.md E2) — mismo patrón publicar_en_ionic() que los scripts
*_export_onnx*.py (CLAUDE.md regla 3), con el mismo --no-ionic-copy para
saltarlo. Solo el escalador de la corrida --n 0 (catálogo completo) debe
publicarse: uno calculado sobre una sub-muestra mediría un mean/std distinto
del que el modelo real (entrenado sobre el catálogo completo) espera, así
que una corrida --n truncada nunca se copia, con o sin la flag.

Uso:
    python prepare_price_dataset.py                # dataset completo (~51.6k cartas con precio)
    python prepare_price_dataset.py --n 1500         # sub-muestra, para iterar rápido
"""

import argparse
import csv
import json
import pathlib
import random
import shutil
import sys

DATA_PREP_DIR = pathlib.Path(__file__).resolve().parent
CARDS_JSON = DATA_PREP_DIR.parent / "training" / "data" / "cards.json"
IMAGES_DIR = DATA_PREP_DIR.parent / "training" / "data" / "images"
PRICE_DATASET_DIR = DATA_PREP_DIR / "data" / "price_dataset"
# Misma convención que 09_export_onnx.py / 18_export_onnx_price_estimator.py
# (CLAUDE.md regla 3), aunque este script no exporta un .onnx — publica un
# artefacto de datos (el escalador) que el cliente Ionic necesita igual.
IONIC_MODELS_DIR = DATA_PREP_DIR.parent.parent / "apps" / "mobile" / "public" / "models"

# src/price_features.py es Python puro (sin torch/tf) — cualquiera de las
# dos copias (pytorch/src o tensorFlow/src) sirve igual, son byte-idénticas.
sys.path.insert(0, str(DATA_PREP_DIR.parent / "training" / "pytorch"))
from src.price_features import NUMERIC_FIELDS, build_tabular_vector, raw_card_fields  # noqa: E402

SEED = 42
VAL_SPLIT = 0.15
TEST_SPLIT = 0.15


def extraer_usd(card: dict) -> float | None:
    """Idéntico a price_estimator_baseline.py::extraer_usd() — duplicado acá
    para no importar ese script entero solo por esta función."""
    usd_raw = (card.get("prices") or {}).get("usd")
    if usd_raw is None:
        return None
    try:
        usd = float(usd_raw)
    except (TypeError, ValueError):
        return None
    return usd if usd > 0 else None


def split_por_carta(card_ids: list[str], val_split: float, test_split: float, seed: int) -> dict:
    """Partición train/val/test por card_id — extiende split_por_carta() de
    pytorch/14_text_validator.py (2 buckets) a 3, ver docstring del módulo."""
    ids = list(card_ids)
    rng = random.Random(seed)
    rng.shuffle(ids)

    n_val = int(len(ids) * val_split)
    n_test = int(len(ids) * test_split)
    val_ids = ids[:n_val]
    test_ids = ids[n_val:n_val + n_test]
    train_ids = ids[n_val + n_test:]
    return {"train": train_ids, "val": val_ids, "test": test_ids}


def calcular_scaler(filas: list[dict], train_ids: set[str]) -> dict:
    """Media/desvío de NUMERIC_FIELDS, calculados solo sobre el split de train."""
    import statistics

    valores_por_campo = {campo: [] for campo in NUMERIC_FIELDS}
    for fila in filas:
        if fila["card_id"] not in train_ids:
            continue
        for campo in NUMERIC_FIELDS:
            valores_por_campo[campo].append(float(fila[campo]))

    medias, desvios = [], []
    for campo in NUMERIC_FIELDS:
        valores = valores_por_campo[campo]
        media = statistics.fmean(valores) if valores else 0.0
        desvio = statistics.pstdev(valores) if len(valores) > 1 else 1.0
        medias.append(media)
        desvios.append(desvio if desvio > 0 else 1.0)

    return {"fields": NUMERIC_FIELDS, "mean": medias, "std": desvios}


def publicar_en_ionic(destino: pathlib.Path, nombre_publico: str) -> pathlib.Path | None:
    """Copia tabular_scaler.json a apps/mobile/public/models/ — ver
    18_export_onnx_price_estimator.py::publicar_en_ionic() (mismo patrón,
    sin sidecar porque esto no es un .onnx)."""
    if not IONIC_MODELS_DIR.parent.exists():
        print(f"  aviso: no se encontró {IONIC_MODELS_DIR.parent} — no se copia a la app Ionic.")
        return None
    IONIC_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    publico = IONIC_MODELS_DIR / nombre_publico
    shutil.copy2(destino, publico)
    return publico


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Arma la mitad tabular + split + escalador del dataset de Stage 3 (Certamen 2)."
    )
    parser.add_argument("--n", type=int, default=0, help="Sub-muestra de N cartas con precio (0 = todas).")
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--val-split", type=float, default=VAL_SPLIT)
    parser.add_argument("--test-split", type=float, default=TEST_SPLIT)
    parser.add_argument("--no-ionic-copy", action="store_true",
                         help="No copiar tabular_scaler.json a apps/mobile/public/models/.")
    args = parser.parse_args()

    if not CARDS_JSON.exists():
        print(f"Error: no existe {CARDS_JSON}. Corré ml/training/01_scraper.py primero.")
        sys.exit(1)

    with open(CARDS_JSON, encoding="utf-8") as f:
        cards = json.load(f)
    print(f"Cartas en el dataset compartido : {len(cards):,}")

    candidatas = []
    for card in cards:
        usd = extraer_usd(card)
        if usd is None:
            continue
        candidatas.append((card, usd))
    print(f"Cartas con precio usd utilizable : {len(candidatas):,} ({len(candidatas) / max(len(cards), 1):.1%})")

    if not candidatas:
        print("Error: ninguna carta tiene prices.usd utilizable.")
        sys.exit(1)

    rng = random.Random(args.seed)
    if args.n and len(candidatas) > args.n:
        candidatas = rng.sample(candidatas, args.n)
        print(f"Sub-muestreado a                : {len(candidatas):,}")

    filas = []
    saltadas_sin_imagen = 0
    for card, usd in candidatas:
        card_id = card["id"]
        if not (IMAGES_DIR / f"{card_id}.jpg").exists():
            saltadas_sin_imagen += 1  # defensivo — hoy la cobertura es 100%, pero no asumido
            continue
        raw = raw_card_fields(card)
        # build_tabular_vector() valida que raw tenga todas las columnas que
        # espera el vector de 48 dims — se llama acá solo para fallar rápido
        # si algún campo vino con una forma inesperada, no se guarda el
        # resultado (eso lo hacen los scripts de entrenamiento).
        build_tabular_vector(raw)
        filas.append({"card_id": card_id, "usd": usd, **raw})
        if len(filas) % 5000 == 0:
            print(f"  {len(filas):,} procesadas...")

    if saltadas_sin_imagen:
        print(f"Saltadas (sin imagen descargada) : {saltadas_sin_imagen:,}")

    if not filas:
        print("Error: ninguna carta con precio tiene imagen descargada.")
        sys.exit(1)

    PRICE_DATASET_DIR.mkdir(parents=True, exist_ok=True)

    card_ids = [f["card_id"] for f in filas]
    split = split_por_carta(card_ids, args.val_split, args.test_split, args.seed)
    print(f"\nSplit por carta — train: {len(split['train']):,}  val: {len(split['val']):,}  test: {len(split['test']):,}")

    scaler = calcular_scaler(filas, set(split["train"]))

    cards_csv_path = PRICE_DATASET_DIR / "cards.csv"
    # Orden estable de columnas (dict.keys() de Python 3.7+ preserva orden de
    # inserción) — usamos las claves reales de la primera fila para no
    # hardcodear la lista acá y desincronizarla de raw_card_fields().
    fieldnames = list(filas[0].keys())
    with open(cards_csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(filas)

    split_json_path = PRICE_DATASET_DIR / "split.json"
    with open(split_json_path, "w", encoding="utf-8") as f:
        json.dump(split, f, indent=2)

    scaler_json_path = PRICE_DATASET_DIR / "tabular_scaler.json"
    with open(scaler_json_path, "w", encoding="utf-8") as f:
        json.dump(scaler, f, indent=2)

    print(f"\ncards.csv          : {cards_csv_path}  ({len(filas):,} filas)")
    print(f"split.json          : {split_json_path}")
    print(f"tabular_scaler.json : {scaler_json_path}")

    # Solo publicar si esto fue una corrida del catálogo completo — un
    # escalador de --n truncado mediría un mean/std distinto del que el
    # modelo real (entrenado sobre el catálogo completo) espera.
    if not args.n and not args.no_ionic_copy:
        publico = publicar_en_ionic(scaler_json_path, "stage3-tabular-scaler.json")
        if publico:
            print(f"Copiado a la app Ionic       : {publico}")
    elif args.n and not args.no_ionic_copy:
        print("(no publicado a Ionic: corrida con --n, no es el catálogo completo)")

    print("\nPróximo paso: correr pytorch/prepare_price_embeddings.py y")
    print("tensorFlow/prepare_price_embeddings.py para precalcular el embedding")
    print("visual congelado (cada uno en el venv de su framework).")


if __name__ == "__main__":
    main()
