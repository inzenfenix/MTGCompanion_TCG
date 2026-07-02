import json
import time
from io import BytesIO
from pathlib import Path
from typing import Any

import requests
from PIL import Image
from tqdm import tqdm

from src.config import HEADERS, SCRYFALL_BULK_API


def fetch_bulk_download_uri(bulk_type: str) -> str:
    response = requests.get(SCRYFALL_BULK_API, headers=HEADERS, timeout=30)
    response.raise_for_status()
    payload = response.json()

    for item in payload["data"]:
        if item["type"] == bulk_type:
            size_mb = item["size"] / (1024**2)
            print(f"Encontrado: {item['name']} ({size_mb:.1f} MB)")
            return item["download_uri"]

    available = [item["type"] for item in payload["data"]]
    raise ValueError(f"Tipo bulk '{bulk_type}' no encontrado. Disponibles: {available}")


def download_catalog(download_uri: str, output_path: Path, force: bool = False) -> list[dict[str, Any]]:
    if output_path.exists() and not force:
        print(f"Catalogo existente: {output_path}")
        return json.loads(output_path.read_text(encoding="utf-8"))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    response = requests.get(download_uri, headers=HEADERS, stream=True, timeout=120)
    response.raise_for_status()

    total_bytes = int(response.headers.get("content-length", 0))
    chunks: list[bytes] = []
    with tqdm(total=total_bytes, unit="B", unit_scale=True, desc="Descargando JSON") as progress:
        for chunk in response.iter_content(chunk_size=1024 * 256):
            if chunk:
                chunks.append(chunk)
                progress.update(len(chunk))

    cards = json.loads(b"".join(chunks).decode("utf-8"))
    output_path.write_text(json.dumps(cards, ensure_ascii=False), encoding="utf-8")
    print(f"Catalogo guardado: {output_path} ({len(cards):,} cartas)")
    return cards


def load_catalog(catalog_path: Path) -> list[dict[str, Any]]:
    if not catalog_path.exists():
        raise FileNotFoundError(f"No existe el catalogo: {catalog_path}")
    return json.loads(catalog_path.read_text(encoding="utf-8"))


def cards_with_image(cards: list[dict[str, Any]], quality: str, max_cards: int | None) -> list[dict[str, Any]]:
    valid_cards = [card for card in cards if card.get("image_uris") and quality in card["image_uris"]]
    return valid_cards if max_cards is None else valid_cards[:max_cards]


def download_images(
    cards: list[dict[str, Any]],
    images_dir: Path,
    names_path: Path,
    quality: str,
    max_cards: int | None,
    delay: float,
) -> list[tuple[Path, str]]:
    images_dir.mkdir(parents=True, exist_ok=True)
    id_to_name: dict[str, str] = {}
    if names_path.exists():
        id_to_name = json.loads(names_path.read_text(encoding="utf-8"))

    selected_cards = cards_with_image(cards=cards, quality=quality, max_cards=max_cards)
    print(f"{len(selected_cards):,} cartas con imagen '{quality}' disponible")

    downloaded = 0
    skipped = 0
    errors = 0

    for card in tqdm(selected_cards, desc="Descargando imagenes"):
        card_id = card["id"]
        card_name = card["name"]
        image_url = card["image_uris"][quality]
        image_path = images_dir / f"{card_id}.jpg"

        if image_path.exists():
            skipped += 1
            id_to_name[card_id] = card_name
            continue

        try:
            response = requests.get(image_url, headers=HEADERS, timeout=15)
            response.raise_for_status()
            image = Image.open(BytesIO(response.content)).convert("RGB")
            image.save(image_path, "JPEG", quality=90)
            id_to_name[card_id] = card_name
            downloaded += 1
            time.sleep(delay)
        except Exception as exc:
            errors += 1
            if errors <= 5:
                print(f"Error en '{card_name}': {exc}")

    names_path.write_text(json.dumps(id_to_name, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Descargadas nuevas: {downloaded:,}; existentes: {skipped:,}; errores: {errors:,}")
    return image_inventory(images_dir=images_dir, names_path=names_path)


def image_inventory(images_dir: Path, names_path: Path) -> list[tuple[Path, str]]:
    if not names_path.exists():
        return []
    id_to_name = json.loads(names_path.read_text(encoding="utf-8"))
    result: list[tuple[Path, str]] = []
    for card_id, name in id_to_name.items():
        image_path = images_dir / f"{card_id}.jpg"
        if image_path.exists():
            result.append((image_path, name))
    return result
