"""
MTG Card Scanner — Certamen 1
Testing/download_random_card.py: descarga una carta aleatoria de Scryfall
para probar los scanners con una imagen que el gallery de pruebas nunca vio.

Guarda la imagen en testing_photos/ y, salvo que se pase --no-compare, llama
a compare_scanners.py para mostrar como reacciona cada framework.

Uso:
    python download_random_card.py
    python download_random_card.py --quality large
    python download_random_card.py --no-compare
    python download_random_card.py --top 10 --threshold 0.8 --skip-detect
"""

import argparse
import pathlib
import re
import subprocess
import sys

import requests

TESTING_DIR = pathlib.Path(__file__).resolve().parent
PHOTOS_DIR  = TESTING_DIR / "testing_photos"

RANDOM_CARD_URL = "https://api.scryfall.com/cards/random"
HEADERS = {"User-Agent": "MTG-Scanner-Academic/1.0"}
TIMEOUT_S = 30


def slugify(nombre: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", nombre.lower()).strip("_")
    return slug or "carta"


def extraer_imagen(card: dict, calidad: str):
    """Igual que 01_scraper.py: maneja cartas de doble cara sin image_uris en la raiz."""
    if "image_uris" in card:
        return card["image_uris"].get(calidad)
    for face in card.get("card_faces", []):
        url = face.get("image_uris", {}).get(calidad)
        if url:
            return url
    return None


def descargar_carta_aleatoria(calidad: str) -> pathlib.Path:
    print("Pidiendo una carta aleatoria a Scryfall...")
    resp = requests.get(RANDOM_CARD_URL, headers=HEADERS, timeout=TIMEOUT_S)
    resp.raise_for_status()
    card = resp.json()

    img_url = extraer_imagen(card, calidad)
    if img_url is None:
        raise RuntimeError(f"La carta '{card.get('name')}' no tiene imagen en calidad '{calidad}'.")

    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    nombre_archivo = f"{slugify(card['name'])}_{card['id'][:8]}.jpg"
    ruta = PHOTOS_DIR / nombre_archivo

    img_resp = requests.get(img_url, headers=HEADERS, timeout=TIMEOUT_S)
    img_resp.raise_for_status()
    ruta.write_bytes(img_resp.content)

    print(f"  Carta      : {card['name']}")
    print(f"  Set        : {card.get('set_name', '?')}")
    print(f"  Scryfall id: {card['id']}")
    print(f"  Guardada en: {ruta}")
    return ruta


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Descarga una carta MTG aleatoria de Scryfall y la compara en ambos scanners.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python download_random_card.py
  python download_random_card.py --quality large
  python download_random_card.py --no-compare
        """
    )
    parser.add_argument("--quality", default="normal", choices=["small", "normal", "large", "png"],
                        help="Calidad de la imagen a descargar (default: normal).")
    parser.add_argument("--no-compare", action="store_true",
                        help="Solo descarga la imagen, no ejecuta la comparacion.")
    parser.add_argument("--top", type=int, default=5, metavar="N",
                        help="Cantidad de candidatos a mostrar al comparar (default: 5).")
    parser.add_argument("--threshold", type=float, default=0.75, metavar="T",
                        help="Umbral de similitud a usar al comparar (default: 0.75).")
    parser.add_argument("--skip-detect", action="store_true",
                        help="Omite el clasificador binario de PyTorch al comparar.")
    args = parser.parse_args()

    try:
        ruta = descargar_carta_aleatoria(args.quality)
    except (requests.RequestException, RuntimeError) as e:
        print(f"Error: {e}")
        sys.exit(1)

    if args.no_compare:
        return

    print()
    cmd = [sys.executable, str(TESTING_DIR / "compare_scanners.py"), str(ruta),
           "--top", str(args.top), "--threshold", str(args.threshold)]
    if args.skip_detect:
        cmd.append("--skip-detect")
    result = subprocess.run(cmd)
    # Sin esto, si compare_scanners.py fallaba este wrapper igual salía con
    # código 0 — mismo problema que los `return` de más arriba, pero acá con
    # el exit code de un subproceso en vez de una excepción local.
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
