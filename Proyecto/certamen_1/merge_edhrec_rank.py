"""
MTG Card Scanner — Certamen 2, Stage 3 (ROADMAP.md workstream B, item B6)
merge_edhrec_rank.py: agrega el campo `edhrec_rank` a data/cards.json.

Deliberadamente NO es 01_scraper.py: ese script sobreescribe cards.json
truncado a --max-cards (destructivo, CLAUDE.md regla 2) — este script solo
AGREGA un campo a las filas que ya existen, nunca toca imágenes ni quita/
trunca filas. Motivo del feature (ver ROADMAP.md B6): las 48 dims tabulares
actuales de price_features.py no tienen ninguna señal de demanda/popularidad
— dos cartas con la misma rareza/set_type/frame pueden diferir en precio por
órdenes de magnitud porque una se juega mucho en Commander y la otra no.
`edhrec_rank` (más bajo = más popular) es la señal más simple que Scryfall
expone para eso.

Fuente de datos: NO vuelve a pegarle a la red si no hace falta —
data/raw_cards.json (el cache del dump bulk completo que ya bajó
01_scraper.py, 116,703 cartas) ya trae `edhrec_rank` para la gran mayoría de
sus filas, confirmado (15 ago): 101,909/116,703 (87.3%). Si ese cache no
existe, este script baja el bulk dump de Scryfall de nuevo (misma lógica de
obtener_url_bulk()/descargar_bulk() de 01_scraper.py, duplicada acá en
versión mínima — mismo criterio de "duplicar lo justo en vez de importar un
script numérico" que ya usa prepare_price_dataset.py con extraer_usd()).

cards.json es un array de "impresiones" (una fila por printing conservado
por 01_scraper.py, hasta MAX_PRINTINGS_POR_CARTA por nombre), cada una con
su propio `id` (Scryfall id de ESA impresión específica) — el merge es por
ese `id`, no por nombre, para no mezclar el edhrec_rank de una impresión con
otra.

Escritura atómica: escribe a un archivo .tmp y lo renombra sobre cards.json
solo después de verificar que la cantidad de filas no cambió — si algo salió
mal a mitad de camino, cards.json original queda intacto.

Uso:
    python merge_edhrec_rank.py
"""

import gzip
import io
import json
import pathlib
import sys

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

DATA_DIR = pathlib.Path(__file__).resolve().parent / "data"
CARDS_JSON = DATA_DIR / "cards.json"
RAW_CACHE = DATA_DIR / "raw_cards.json"

BULK_DATA_URL = "https://api.scryfall.com/bulk-data"
HEADERS = {"User-Agent": "MTG-Scanner-Academic/1.0"}


def _descargar_bulk_fresco() -> list:
    """Versión mínima de descargar_bulk()/obtener_url_bulk() de 01_scraper.py
    — solo se usa si no hay cache local. No escribe raw_cards.json (ese
    archivo es responsabilidad de 01_scraper.py); guarda su propia copia
    aparte para no pisar convenciones de otro script."""
    print("No hay cache local, consultando Scryfall bulk-data endpoint...")
    resp = requests.get(BULK_DATA_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    url = None
    for entry in resp.json()["data"]:
        if entry["type"] == "default_cards":
            url = entry["jsonl_download_uri"]
            break
    if url is None:
        raise RuntimeError("No se encontró entry 'default_cards' en bulk-data")

    print("Descargando cards desde Scryfall (jsonl.gz)...")
    resp = requests.get(url, headers=HEADERS, stream=True, timeout=180)
    resp.raise_for_status()

    buffer = io.BytesIO()
    for chunk in resp.iter_content(chunk_size=1_048_576):
        buffer.write(chunk)
    buffer.seek(0)

    todas = []
    with gzip.GzipFile(fileobj=buffer) as gz:
        for linea in gz:
            linea = linea.strip()
            if linea:
                todas.append(json.loads(linea))
    return todas


def cargar_raw_cards() -> list:
    if RAW_CACHE.exists():
        print(f"Usando cache existente: {RAW_CACHE}")
        with open(RAW_CACHE, encoding="utf-8") as f:
            return json.load(f)
    return _descargar_bulk_fresco()


def main() -> None:
    if not CARDS_JSON.exists():
        print(f"Error: no existe {CARDS_JSON}. Corré 01_scraper.py primero.")
        sys.exit(1)

    raw_cards = cargar_raw_cards()
    print(f"Cartas en el dump crudo de Scryfall : {len(raw_cards):,}")

    rank_por_id = {}
    for card in raw_cards:
        rank = card.get("edhrec_rank")
        if rank is not None:
            rank_por_id[card["id"]] = rank
    print(f"  con edhrec_rank                   : {len(rank_por_id):,} ({len(rank_por_id) / max(len(raw_cards), 1):.1%})")

    with open(CARDS_JSON, encoding="utf-8") as f:
        cards = json.load(f)
    n_original = len(cards)
    print(f"\nCartas en {CARDS_JSON.name}                 : {n_original:,}")

    n_con_rank = 0
    for card in cards:
        rank = rank_por_id.get(card["id"])
        card["edhrec_rank"] = rank
        if rank is not None:
            n_con_rank += 1

    print(f"  merged con edhrec_rank             : {n_con_rank:,} ({n_con_rank / max(n_original, 1):.1%})")
    print(f"  sin edhrec_rank (queda None)        : {n_original - n_con_rank:,}")

    if len(cards) != n_original:
        print("Error: la cantidad de filas cambió durante el merge, algo está mal. Abortando sin escribir.")
        sys.exit(1)

    tmp_path = CARDS_JSON.with_suffix(".json.tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(cards, f, ensure_ascii=False, indent=2)
    tmp_path.replace(CARDS_JSON)

    print(f"\nGuardado: {CARDS_JSON}  ({CARDS_JSON.stat().st_size / 1e6:.1f} MB)")
    print("Siguiente paso: certamen_2/prepare_price_dataset.py (regenera cards.csv/scaler con la nueva columna).")


if __name__ == "__main__":
    main()
