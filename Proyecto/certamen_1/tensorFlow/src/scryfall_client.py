import json
from pathlib import Path
from typing import Any


def load_catalog(catalog_path: Path) -> list[dict[str, Any]]:
    if not catalog_path.exists():
        raise FileNotFoundError(f"No existe el catalogo: {catalog_path}")
    return json.loads(catalog_path.read_text(encoding="utf-8"))


def image_inventory(images_dir: Path, catalog_json: Path) -> list[tuple[str, Path, str]]:
    """Retorna (card_id, image_path, card_name) para cartas con imagen descargada."""
    if not catalog_json.exists() or not images_dir.exists():
        return []
    cards = load_catalog(catalog_json)
    result: list[tuple[str, Path, str]] = []
    for card in cards:
        image_path = images_dir / f"{card['id']}.jpg"
        if image_path.exists():
            result.append((card["id"], image_path, card["name"]))
    return result
