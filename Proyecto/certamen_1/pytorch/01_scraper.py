"""
MTG Card Scanner — Certamen 1
01_scraper.py: Descarga el catálogo de cartas desde la API de Scryfall.

Scryfall provee un dump JSON diario gratuito con todas las cartas impresas.
No requiere API key. Endpoint: https://api.scryfall.com/bulk-data

Salida:
    data/raw_cards.json   — dump original (cache local)
    data/cards.json       — dataset limpio y filtrado

Filtros aplicados:
    - Idioma inglés (lang == "en")
    - Set types: expansion, core, masters, draft_innovation
    - Con imagen disponible
    - Sin duplicados por nombre (conserva la impresión más reciente)
"""

import json
import pathlib
import requests

# ── Configuración ─────────────────────────────────────────────────────────────
DATA_DIR = pathlib.Path("data")

BULK_DATA_URL = "https://api.scryfall.com/bulk-data"

# Scryfall requiere un User-Agent personalizado (bloquea el genérico de requests)
HEADERS = {"User-Agent": "MTG-Scanner-Academic/1.0 (UDD Frameworks de IA)"}

ALLOWED_SET_TYPES = {"expansion", "core", "masters", "draft_innovation", "commander"}

CAMPOS = [
    "id", "name", "set", "set_name", "collector_number",
    "rarity", "colors", "color_identity", "type_line",
    "mana_cost", "cmc", "released_at", "set_type",
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def obtener_url_bulk() -> str:
    """Consulta el endpoint de bulk-data y retorna la URL de 'default_cards'."""
    print("Consultando Scryfall bulk-data endpoint...")
    resp = requests.get(BULK_DATA_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    for entry in resp.json()["data"]:
        if entry["type"] == "default_cards":
            size_mb = entry["size"] / 1_000_000
            updated = entry["updated_at"][:10]
            print(f"  → {entry['name']}  |  {size_mb:.0f} MB  |  actualizado {updated}")
            return entry["download_uri"]

    raise RuntimeError("No se encontró entry 'default_cards' en bulk-data")


def descargar_bulk(url: str) -> list:
    """
    Descarga el JSON completo de cartas
    Si ya existe un cache local lo reutiliza
    """
    cache = DATA_DIR / "raw_cards.json"

    if cache.exists():
        print(f"Cache encontrado en {cache}")
        with open(cache, encoding="utf-8") as f:
            return json.load(f)

    print("Descargando cards desde Scryfall...")
    resp = requests.get(url, headers=HEADERS, stream=True, timeout=180)
    resp.raise_for_status()

    total = int(resp.headers.get("content-length", 0))
    descargado = 0
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with open(cache, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1_048_576):
            f.write(chunk)
            descargado += len(chunk)
            if total:
                pct = descargado / total * 100
                print(f"\r  {descargado / 1e6:.1f} / {total / 1e6:.0f} MB  ({pct:.0f}%)", end="", flush=True)

    print()
    with open(cache, encoding="utf-8") as f:
        return json.load(f)


def extraer_imagen(card: dict):
    """
    Extorna la URL de imagen 'normal' de una carta.
    Maneja cartas de doble cara (card_faces) que no tienen image_uris en el root.
    """
    if "image_uris" in card:
        return card["image_uris"].get("normal")
    if "card_faces" in card:
        for face in card["card_faces"]:
            url = face.get("image_uris", {}).get("normal")
            if url:
                return url
    return None


def filtrar_y_limpiar(todas: list) -> list:
    """
    Filtra el dump completo y retorna solo los campos relevantes.
    Estrategia de deduplicación: si la misma carta tiene varias impresiones,
    conserva la más reciente (released_at más alto).
    """
    vistas: dict = {}
    omitidas = {"idioma": 0, "set_type": 0, "sin_imagen": 0, "token_arte": 0}

    for card in todas:
        # Ignorar tokens, cartas de arte, etc.
        if card.get("layout") in {"token", "art_series", "double_faced_token", "emblem"}:
            omitidas["token_arte"] += 1
            continue

        if card.get("lang") != "en":
            omitidas["idioma"] += 1
            continue

        if card.get("set_type") not in ALLOWED_SET_TYPES:
            omitidas["set_type"] += 1
            continue

        img_url = extraer_imagen(card)
        if not img_url:
            omitidas["sin_imagen"] += 1
            continue

        entry = {campo: card.get(campo) for campo in CAMPOS}
        entry["image_url"] = img_url

        # Deduplicar por nombre de carta (reprints)
        nombre = card["name"]
        if nombre not in vistas or (entry["released_at"] or "") > (vistas[nombre]["released_at"] or ""):
            vistas[nombre] = entry

    resultado = list(vistas.values())

    print(f"\n{'─' * 50}")
    print(f"  Total raw:              {len(todas):>6,}")
    for motivo, n in omitidas.items():
        print(f"  Omitidas ({motivo:<12}): {n:>6,}")
    print(f"  Dataset final:          {len(resultado):>6,}")
    print(f"{'─' * 50}")

    # Estadísticas por rareza
    from collections import Counter
    rarezas = Counter(c.get("rarity", "unknown") for c in resultado)
    print("  Distribución de rareza:")
    for rareza, n in sorted(rarezas.items()):
        print(f"    {rareza:<10}: {n:>5,}")

    return resultado


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    url = obtener_url_bulk()
    todas = descargar_bulk(url)
    filtradas = filtrar_y_limpiar(todas)

    output = DATA_DIR / "cards.json"
    with open(output, "w", encoding="utf-8") as f:
        json.dump(filtradas, f, ensure_ascii=False, indent=2)

    print(f"\nGuardado: {output}  ({output.stat().st_size / 1e6:.1f} MB)")
    print(f"Siguiente paso: python 02_downloader.py")


if __name__ == "__main__":
    main()
