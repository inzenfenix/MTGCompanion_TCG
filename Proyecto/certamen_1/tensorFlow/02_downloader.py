import argparse

from src.config import DELAY_BETWEEN_REQS, IMAGE_QUALITY, MAX_CARDS, PATHS
from src.scryfall_client import download_images, load_catalog


def main() -> None:
    parser = argparse.ArgumentParser(description="Descarga imagenes de cartas desde el catalogo local.")
    parser.add_argument("--quality", default=IMAGE_QUALITY, help="Calidad de imagen de Scryfall.")
    parser.add_argument("--max-cards", type=int, default=MAX_CARDS, help="Cantidad maxima de cartas.")
    parser.add_argument("--all", action="store_true", help="Descarga todas las cartas disponibles.")
    parser.add_argument("--delay", type=float, default=DELAY_BETWEEN_REQS, help="Pausa entre requests.")
    args = parser.parse_args()

    PATHS.ensure_directories()
    cards = load_catalog(PATHS.catalog_json)
    image_list = download_images(
        cards=cards,
        images_dir=PATHS.images_dir,
        names_path=PATHS.card_names_json,
        quality=args.quality,
        max_cards=None if args.all else args.max_cards,
        delay=args.delay,
    )
    print(f"Imagenes disponibles localmente: {len(image_list):,}")


if __name__ == "__main__":
    main()
