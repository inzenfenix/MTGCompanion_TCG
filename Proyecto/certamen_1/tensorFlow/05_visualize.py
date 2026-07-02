import argparse
from pathlib import Path

from src.config import PATHS, SIMILARITY_THRESHOLD, TOP_K
from src.predictor import predict_image
from src.scryfall_client import image_inventory
from src.visualization import preview_images, visualize_prediction


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera visualizaciones del dataset o de una prediccion.")
    parser.add_argument("--preview", action="store_true", help="Muestra una grilla de cartas descargadas.")
    parser.add_argument("--image", type=Path, help="Imagen a evaluar y visualizar.")
    parser.add_argument("--output", type=Path, help="Archivo PNG de salida.")
    parser.add_argument("--top-k", type=int, default=TOP_K)
    parser.add_argument("--threshold", type=float, default=SIMILARITY_THRESHOLD)
    args = parser.parse_args()

    if args.preview:
        image_list = image_inventory(images_dir=PATHS.images_dir, catalog_json=PATHS.catalog_json)
        preview_images(image_list=image_list, output_path=args.output)
        return

    if not args.image:
        raise SystemExit("Usa --preview o entrega --image ruta/a/imagen.jpg")

    prediction = predict_image(
        image_path=args.image,
        index_path=PATHS.embedding_index,
        top_k=args.top_k,
        threshold=args.threshold,
    )
    visualize_prediction(
        query_image=args.image,
        prediction=prediction,
        images_dir=PATHS.images_dir,
        catalog_json=PATHS.catalog_json,
        output_path=args.output,
    )


if __name__ == "__main__":
    main()
