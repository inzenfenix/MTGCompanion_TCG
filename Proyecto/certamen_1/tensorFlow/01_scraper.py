import argparse

from src.config import BULK_TYPE, PATHS
from src.scryfall_client import download_catalog, fetch_bulk_download_uri


def main() -> None:
    parser = argparse.ArgumentParser(description="Descarga el catalogo bulk de Scryfall.")
    parser.add_argument("--bulk-type", default=BULK_TYPE, help="Tipo bulk de Scryfall.")
    parser.add_argument("--force", action="store_true", help="Vuelve a descargar aunque exista el JSON.")
    args = parser.parse_args()

    PATHS.ensure_directories()
    download_uri = fetch_bulk_download_uri(args.bulk_type)
    cards = download_catalog(download_uri=download_uri, output_path=PATHS.catalog_json, force=args.force)
    print(f"Cartas disponibles en catalogo: {len(cards):,}")


if __name__ == "__main__":
    main()
