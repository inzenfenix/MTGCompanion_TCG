"""
MTG Card Scanner — Certamen 1
pytorch: Tomás Solano
tensorflow: Joaquín Rodriguez

01_scraper.py: Descarga el catálogo de cartas desde la API de Scryfall.
Script compartido por ambos pipelines (pytorch/ y tensorFlow/).

Salida (carpeta compartida data/, junto a este script):
    data/raw_cards.json   — dump original (cache local)
    data/cards.json       — dataset limpio y filtrado

Filtros aplicados:
    - Idioma inglés (lang == "en")
    - Set types: expansion, core, masters, draft_innovation, commander
    - Con imagen disponible
    - Hasta MAX_PRINTINGS_POR_CARTA impresiones por nombre de carta, priorizando
      estilos visualmente distintos (frame / border_color / frame_effects) para
      que el dataset cubra distintos borders, foils y frames de una misma carta
      en vez de solo la impresión más reciente (ver ml/data-prep/README.md).
"""

import argparse
import gzip
import io
import json
import pathlib
import random
import sys
import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# ── Configuración ─────────────────────────────────────────────────────────────
DATA_DIR = pathlib.Path(__file__).resolve().parent / "data"
SEED = 42

BULK_DATA_URL = "https://api.scryfall.com/bulk-data"

# Scryfall requiere un User-Agent personalizado (bloquea el genérico de requests)
HEADERS = {"User-Agent": "MTG-Scanner-Academic/1.0"}

ALLOWED_SET_TYPES = {"expansion", "core", "masters", "draft_innovation", "commander"}

# Cuántas impresiones distintas de una misma carta conservar como máximo
# (diversidad de frame/border/foil para Certamen 2, ver docstring del módulo).
MAX_PRINTINGS_POR_CARTA = 3

CAMPOS = [
    "id", "name", "set", "set_name", "collector_number",
    "rarity", "colors", "color_identity", "type_line",
    "mana_cost", "cmc", "released_at", "set_type",
    "oracle_text",  # Certamen 2 — Modelo 2 (validador de texto/OCR)
    "prices",       # Certamen 2 — Modelo 3 (estimador de precio): usd/usd_foil/eur/tix
    "frame", "border_color", "frame_effects", "finishes",  # estilo visual + señal de precio (foil)
]


def obtener_url_bulk() -> str:
    """
    Consulta el endpoint de bulk-data y retorna la URL jsonl.gz de 'default_cards'.

    Scryfall migró bulk-data de un JSON array (`download_uri`/`size`) a JSONL
    comprimido con gzip (`jsonl_download_uri`/`compressed_size`) — este parseo
    sigue el formato nuevo.
    """
    print("Consultando Scryfall bulk-data endpoint...")
    resp = requests.get(BULK_DATA_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()

    for entry in resp.json()["data"]:
        if entry["type"] == "default_cards":
            size_mb = entry["compressed_size"] / 1_000_000
            updated = entry["updated_at"][:10]
            print(f"  → {entry['name']}  |  {size_mb:.0f} MB comprimido  |  actualizado {updated}")
            return entry["jsonl_download_uri"]

    raise RuntimeError("No se encontró entry 'default_cards' en bulk-data")


def descargar_bulk() -> list:
    """
    Descarga y descomprime el dump de cartas (JSONL gzip) de Scryfall.
    Si ya existe un cache local (data/raw_cards.json) lo reutiliza sin tocar
    la red — ese cache siempre se guarda como JSON array plano, independiente
    de qué formato use Scryfall para el download.
    """
    cache = DATA_DIR / "raw_cards.json"

    if cache.exists():
        print(f"Cache encontrado en {cache}")
        with open(cache, encoding="utf-8") as f:
            return json.load(f)

    url = obtener_url_bulk()

    print("Descargando cards desde Scryfall (jsonl.gz)...")
    resp = requests.get(url, headers=HEADERS, stream=True, timeout=180)
    resp.raise_for_status()

    total = int(resp.headers.get("content-length", 0))
    descargado = 0
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    buffer = io.BytesIO()
    for chunk in resp.iter_content(chunk_size=1_048_576):
        buffer.write(chunk)
        descargado += len(chunk)
        if total:
            pct = descargado / total * 100
            print(f"\r  {descargado / 1e6:.1f} / {total / 1e6:.0f} MB comprimido  ({pct:.0f}%)", end="", flush=True)
    print()

    print("Descomprimiendo y parseando JSONL...")
    buffer.seek(0)
    todas = []
    with gzip.GzipFile(fileobj=buffer) as gz:
        for linea in gz:
            linea = linea.strip()
            if linea:
                todas.append(json.loads(linea))

    with open(cache, "w", encoding="utf-8") as f:
        json.dump(todas, f, ensure_ascii=False)

    return todas


def extraer_imagen(card: dict, calidad: str):
    """
    Extrae la URL de imagen (calidad `calidad`) de una carta.
    Maneja cartas de doble cara (card_faces) que no tienen image_uris en el root.
    """
    if "image_uris" in card:
        return card["image_uris"].get(calidad)
    if "card_faces" in card:
        for face in card["card_faces"]:
            url = face.get("image_uris", {}).get(calidad)
            if url:
                return url
    return None


def firma_estilo(entry: dict) -> tuple:
    """Firma visual de una impresión: frame + border + efectos de frame (foil se ve en `finishes`)."""
    return (entry.get("frame"), entry.get("border_color"), tuple(sorted(entry.get("frame_effects") or [])))


def seleccionar_impresiones(entradas: list, max_impresiones: int = MAX_PRINTINGS_POR_CARTA) -> list:
    """
    Selecciona hasta `max_impresiones` impresiones de una misma carta.

    Ordena por fecha (más reciente primero) y prioriza impresiones cuya firma de
    estilo (frame/border/frame_effects) todavía no esté cubierta, para que el
    dataset tenga distintos borders/frames de una misma carta en vez de solo
    reprints visualmente idénticos. Si sobran cupos sin estilos nuevos que
    agregar, se completa con las impresiones restantes más recientes.
    """
    entradas_ordenadas = sorted(entradas, key=lambda e: e.get("released_at") or "", reverse=True)
    if len(entradas_ordenadas) <= max_impresiones:
        return entradas_ordenadas

    seleccionadas, restantes, firmas_vistas = [], [], set()
    for entrada in entradas_ordenadas:
        firma = firma_estilo(entrada)
        if firma not in firmas_vistas and len(seleccionadas) < max_impresiones:
            seleccionadas.append(entrada)
            firmas_vistas.add(firma)
        else:
            restantes.append(entrada)

    for entrada in restantes:
        if len(seleccionadas) >= max_impresiones:
            break
        seleccionadas.append(entrada)

    return seleccionadas


def filtrar_y_limpiar(todas: list, calidad: str, max_cards: int) -> list:
    """
    Filtra el dump completo y retorna solo los campos relevantes.
    Agrupa impresiones por nombre de carta y conserva hasta
    MAX_PRINTINGS_POR_CARTA por nombre (ver `seleccionar_impresiones`).
    """
    grupos: dict = {}
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

        img_url = extraer_imagen(card, calidad)
        if not img_url:
            omitidas["sin_imagen"] += 1
            continue

        entry = {campo: card.get(campo) for campo in CAMPOS}
        entry["image_url"] = img_url

        grupos.setdefault(card["name"], []).append(entry)

    resultado = []
    for entradas in grupos.values():
        resultado.extend(seleccionar_impresiones(entradas))
    total_impresiones = len(resultado)
    total_nombres = len(grupos)

    if max_cards is not None and total_impresiones > max_cards:
        random.Random(SEED).shuffle(resultado)
        resultado = resultado[:max_cards]

    print(f"\n{'─' * 50}")
    print(f"  Total raw:              {len(todas):>6,}")
    for motivo, n in omitidas.items():
        print(f"  Omitidas ({motivo:<12}): {n:>6,}")
    print(f"  Nombres de carta únicos:{total_nombres:>6,}")
    print(f"  Impresiones (≤{MAX_PRINTINGS_POR_CARTA}/carta):   {total_impresiones:>6,}  ({total_impresiones / max(total_nombres, 1):.2f}/carta en promedio)")
    print(f"  Dataset final (cap):    {len(resultado):>6,}")
    print(f"{'─' * 50}")

    # Estadísticas por rareza
    from collections import Counter
    rarezas = Counter(c.get("rarity", "unknown") for c in resultado)
    print("  Distribución de rareza:")
    for rareza, n in sorted(rarezas.items()):
        print(f"    {rareza:<10}: {n:>5,}")

    return resultado


def main():
    parser = argparse.ArgumentParser(description="Descarga y filtra el catálogo de cartas de Scryfall.")
    parser.add_argument("--max-cards", type=int, default=5000,
                        help="Cap del dataset en impresiones, no en nombres únicos "
                             "(0 = sin cap; sin cap salen ~30,000 nombres × hasta "
                             f"{MAX_PRINTINGS_POR_CARTA} impresiones c/u). default: 5000")
    parser.add_argument("--quality", default="small",
                        help="Calidad de imagen de Scryfall (small, normal, large, png). default: small")
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    max_cards = None if args.max_cards == 0 else args.max_cards

    todas = descargar_bulk()
    filtradas = filtrar_y_limpiar(todas, calidad=args.quality, max_cards=max_cards)

    output = DATA_DIR / "cards.json"
    with open(output, "w", encoding="utf-8") as f:
        json.dump(filtradas, f, ensure_ascii=False, indent=2)

    print(f"\nGuardado: {output}  ({output.stat().st_size / 1e6:.1f} MB)")
    print(f"Siguiente paso: python 02_downloader.py")


if __name__ == "__main__":
    main()
