import argparse

from src.config import PATHS
from src.embeddings import build_index
from src.scryfall_client import image_inventory


def main() -> None:
    parser = argparse.ArgumentParser(description="Construye el indice de embeddings con MobileNetV2.")
    parser.add_argument("--force", action="store_true", help="Reconstruye aunque el indice ya exista.")
    args = parser.parse_args()

    PATHS.ensure_directories()
    if PATHS.embedding_index.exists() and not args.force:
        print(f"Indice existente: {PATHS.embedding_index}")
        print("Usa --force para reconstruirlo.")
        return

    image_list = image_inventory(images_dir=PATHS.images_dir, names_path=PATHS.card_names_json)
    if not image_list:
        raise SystemExit("No hay imagenes indexables. Ejecuta 02_downloader.py primero.")
    build_index(image_list=image_list, output_path=PATHS.embedding_index)


if __name__ == "__main__":
    main()
